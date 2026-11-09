use crate::download::{download_verified, DownloadError};
use crate::platform::{asset_for, current};
use crate::process;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::process::Child;
use std::thread;
use std::time::{Duration, Instant};
use ureq::Agent;

pub const EMBEDDED_ORIGIN: &str = "http://127.0.0.1:8090";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerMode {
    Embedded,
    External,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerStatus {
    Stopped,
    Starting,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStartRequest {
    pub mode: ServerMode,
    pub origin: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerHandle {
    pub mode: ServerMode,
    pub origin: String,
    pub status: ServerStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug)]
pub enum ServerError {
    Download(DownloadError),
    Platform(String),
    Launch(String),
    Io(io::Error),
}

impl fmt::Display for ServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Download(error) => write!(f, "{error}"),
            Self::Platform(error) | Self::Launch(error) => write!(f, "{error}"),
            Self::Io(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for ServerError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Download(error) => Some(error),
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<DownloadError> for ServerError {
    fn from(error: DownloadError) -> Self {
        Self::Download(error)
    }
}

impl From<io::Error> for ServerError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub data_dir: PathBuf,
    pub origin: String,
    pub port: u16,
    pub startup_timeout: Duration,
}

impl ServerConfig {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
            origin: EMBEDDED_ORIGIN.to_string(),
            port: 8090,
            startup_timeout: Duration::from_secs(15),
        }
    }

    pub fn from_environment() -> Result<Self, ServerError> {
        let root = dirs::data_local_dir().ok_or_else(|| {
            ServerError::Launch("application data directory is unavailable".to_string())
        })?;
        Ok(Self::new(
            root.join("com.spacesarmat.omp.desktop").join("torrserver"),
        ))
    }
}

type Launcher = dyn Fn(&ServerConfig) -> Result<Child, ServerError> + Send + Sync + 'static;

pub struct ServerManager {
    config: ServerConfig,
    handle: ServerHandle,
    child: Option<Child>,
    launcher: Box<Launcher>,
}

impl ServerManager {
    pub fn new(config: ServerConfig) -> Self {
        Self::with_launcher(config, |config| {
            let target = current().map_err(ServerError::Platform)?;
            let binary = download_verified(asset_for(target)?)?;
            fs::create_dir_all(&config.data_dir)?;
            let log_path = config.data_dir.join("server.log");
            process::command(&binary)
                .arg("--port")
                .arg(config.port.to_string())
                .arg("--path")
                .arg(&config.data_dir)
                .arg("--logpath")
                .arg(log_path)
                .current_dir(&config.data_dir)
                .env("HOME", &config.data_dir)
                .spawn()
                .map_err(ServerError::Io)
        })
    }

    pub fn with_launcher<F>(config: ServerConfig, launcher: F) -> Self
    where
        F: Fn(&ServerConfig) -> Result<Child, ServerError> + Send + Sync + 'static,
    {
        let handle = ServerHandle {
            mode: ServerMode::Embedded,
            origin: config.origin.clone(),
            status: ServerStatus::Stopped,
            error: None,
        };
        Self {
            config,
            handle,
            child: None,
            launcher: Box::new(launcher),
        }
    }

    pub fn start(&mut self, request: ServerStartRequest) -> ServerHandle {
        self.refresh();
        if request.mode == ServerMode::Embedded
            && self.handle.mode == ServerMode::Embedded
            && self.handle.status == ServerStatus::Ready
        {
            return self.handle.clone();
        }
        self.stop_process();
        match request.mode {
            ServerMode::Embedded => self.start_embedded(),
            ServerMode::External => self.start_external(request.origin),
        }
    }

    fn start_embedded(&mut self) -> ServerHandle {
        self.handle = ServerHandle {
            mode: ServerMode::Embedded,
            origin: self.config.origin.clone(),
            status: ServerStatus::Starting,
            error: None,
        };
        if health(&self.config.origin) {
            return self.fail("loopback port is already in use".to_string());
        }
        let mut child = match (self.launcher)(&self.config) {
            Ok(child) => child,
            Err(error) => return self.fail(error.to_string()),
        };
        match wait_for_health(&self.config, Some(&mut child)) {
            Ok(true) => {
                self.child = Some(child);
                self.handle.status = ServerStatus::Ready;
            }
            Ok(false) => {
                let _ = process::stop(&mut child);
                self.handle.status = ServerStatus::Error;
                self.handle.error = Some("server did not respond to /echo".to_string());
            }
            Err(error) => {
                let _ = process::stop(&mut child);
                self.handle.status = ServerStatus::Error;
                self.handle.error = Some(error.to_string());
            }
        }
        self.handle.clone()
    }

    fn start_external(&mut self, origin: Option<String>) -> ServerHandle {
        let Some(origin) = origin else {
            self.handle.mode = ServerMode::External;
            return self.fail("external origin is required".to_string());
        };
        let origin = origin.trim_end_matches('/').to_string();
        if !has_http_scheme(&origin) {
            self.handle.mode = ServerMode::External;
            self.handle.origin = origin;
            return self.fail("external origin must use HTTP or HTTPS".to_string());
        }
        self.handle = ServerHandle {
            mode: ServerMode::External,
            origin: origin.clone(),
            status: ServerStatus::Starting,
            error: None,
        };
        let config = ServerConfig {
            origin,
            ..self.config.clone()
        };
        match wait_for_health(&config, None) {
            Ok(true) => self.handle.status = ServerStatus::Ready,
            Ok(false) => {
                self.handle.status = ServerStatus::Error;
                self.handle.error = Some("external server did not respond to /echo".to_string());
            }
            Err(error) => {
                self.handle.status = ServerStatus::Error;
                self.handle.error = Some(error.to_string());
            }
        }
        self.handle.clone()
    }

    fn fail(&mut self, error: String) -> ServerHandle {
        self.handle.status = ServerStatus::Error;
        self.handle.error = Some(error);
        self.handle.clone()
    }

    pub fn stop(&mut self) -> ServerHandle {
        self.stop_process();
        self.handle.status = ServerStatus::Stopped;
        self.handle.error = None;
        self.handle.clone()
    }

    pub fn status(&mut self) -> ServerHandle {
        self.refresh();
        self.handle.clone()
    }

    pub fn update(&mut self) -> ServerHandle {
        if self.handle.mode == ServerMode::External {
            return self.status();
        }
        self.stop();
        self.start(ServerStartRequest {
            mode: ServerMode::Embedded,
            origin: None,
        })
    }

    fn refresh(&mut self) {
        let exited = match self.child.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => true,
                Ok(None) => false,
                Err(_) => true,
            },
            None => false,
        };
        if exited {
            self.child = None;
            self.handle.status = ServerStatus::Error;
            self.handle.error = Some("server process exited".to_string());
        }
        if self.handle.mode == ServerMode::External
            && self.handle.status == ServerStatus::Ready
            && !health(&self.handle.origin)
        {
            self.handle.status = ServerStatus::Error;
            self.handle.error = Some("external server did not respond to /echo".to_string());
        }
    }

    fn stop_process(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = process::stop(&mut child);
        }
    }
}

impl Drop for ServerManager {
    fn drop(&mut self) {
        self.stop_process();
    }
}

fn wait_for_health(
    config: &ServerConfig,
    mut child: Option<&mut Child>,
) -> Result<bool, ServerError> {
    let deadline = Instant::now() + config.startup_timeout;
    loop {
        if let Some(process) = child.as_deref_mut() {
            if process.try_wait()?.is_some() {
                return Ok(false);
            }
        }
        if health(&config.origin) {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn health(origin: &str) -> bool {
    let agent = Agent::new_with_config(
        Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_millis(500)))
            .build(),
    );
    agent
        .get(format!("{}/echo", origin.trim_end_matches('/')))
        .call()
        .is_ok_and(|response| response.status().as_u16() == 200)
}

fn has_http_scheme(origin: &str) -> bool {
    ["http://", "https://"].iter().any(|scheme| {
        origin
            .get(..scheme.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme))
    })
}

#[cfg(test)]
mod tests;
