use crate::download::{download_verified, DownloadError};
use crate::platform::current;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;

pub use crate::platform::{mpv_asset_for, TargetPlatform};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayerState {
    Idle,
    Starting,
    Playing,
    Paused,
    Ended,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStatus {
    pub state: PlayerState,
    pub position_ms: u64,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerOpenRequest {
    pub url: String,
    pub title: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub start_ms: Option<u64>,
}

pub trait PlayerProcess: Send {
    fn pause(&mut self, paused: bool) -> Result<(), String>;
    fn position(&self) -> Result<(u64, u64), String>;
    fn stop(&mut self) -> Result<(), String>;
    fn try_wait(&mut self) -> Result<Option<i32>, String>;
}

type Launcher =
    dyn Fn(&PlayerOpenRequest) -> Result<Box<dyn PlayerProcess>, String> + Send + Sync + 'static;

pub struct PlayerManager {
    status: PlayerStatus,
    process: Option<Box<dyn PlayerProcess>>,
    launcher: Box<Launcher>,
}

impl PlayerManager {
    pub fn with_launcher<F>(launcher: F) -> Self
    where
        F: Fn(&PlayerOpenRequest) -> Result<Box<dyn PlayerProcess>, String> + Send + Sync + 'static,
    {
        Self {
            status: PlayerStatus {
                state: PlayerState::Idle,
                position_ms: 0,
                duration_ms: 0,
                error: None,
            },
            process: None,
            launcher: Box::new(launcher),
        }
    }

    pub fn open(&mut self, request: PlayerOpenRequest) -> PlayerStatus {
        self.stop();
        self.status.state = PlayerState::Starting;
        match (self.launcher)(&request) {
            Ok(process) => {
                self.process = Some(process);
                self.status.state = PlayerState::Playing;
            }
            Err(_) => {
                self.status = PlayerStatus {
                    state: PlayerState::Error,
                    position_ms: 0,
                    duration_ms: 0,
                    error: Some("player launch failed".to_string()),
                }
            }
        }
        self.status.clone()
    }

    pub fn pause(&mut self) -> PlayerStatus {
        let Some(process) = self.process.as_mut() else {
            return self.status.clone();
        };
        let paused = match self.status.state {
            PlayerState::Playing => true,
            PlayerState::Paused => false,
            _ => return self.status.clone(),
        };
        match process.pause(paused) {
            Ok(()) => {
                self.status.state = if paused {
                    PlayerState::Paused
                } else {
                    PlayerState::Playing
                };
            }
            Err(_) => self.status.error = Some("player pause failed".to_string()),
        }
        self.status.clone()
    }

    pub fn stop(&mut self) -> PlayerStatus {
        if let Some(mut process) = self.process.take() {
            let _ = process.stop();
        }
        self.status = PlayerStatus {
            state: PlayerState::Idle,
            position_ms: 0,
            duration_ms: 0,
            error: None,
        };
        self.status.clone()
    }

    pub fn status(&mut self) -> PlayerStatus {
        let Some(process) = self.process.as_mut() else {
            return self.status.clone();
        };
        match process.try_wait() {
            Ok(Some(code)) => {
                self.status.state = if code == 0 {
                    PlayerState::Ended
                } else {
                    PlayerState::Error
                };
                if code != 0 {
                    self.status.error = Some("player process exited".to_string());
                }
            }
            Ok(None) => match process.position() {
                Ok((position, duration)) => {
                    self.status.position_ms = position;
                    self.status.duration_ms = duration;
                }
                Err(_) => self.status.error = Some("player status failed".to_string()),
            },
            Err(_) => self.status.error = Some("player status failed".to_string()),
        }
        self.status.clone()
    }
}

impl Drop for PlayerManager {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Clone, Debug)]
pub struct PlayerConfig {
    pub data_dir: PathBuf,
}

impl PlayerConfig {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
        }
    }

    pub fn from_environment() -> Result<Self, DownloadError> {
        let root = dirs::data_local_dir().ok_or(DownloadError::StorageUnavailable)?;
        Ok(Self::new(
            root.join("com.spacesarmat.omp.desktop").join("mpv-v3"),
        ))
    }
}

impl PlayerManager {
    pub fn new(config: PlayerConfig) -> Self {
        Self::with_launcher(move |request| {
            let target = current().map_err(|_| "unsupported player target".to_string())?;
            let asset =
                mpv_asset_for(target).map_err(|_| "unsupported player target".to_string())?;
            let archive =
                download_verified(asset).map_err(|_| "mpv download failed".to_string())?;
            let binary = extract_mpv(&archive, &config.data_dir)?;
            let ipc = ipc_path(&config);
            let mut command = crate::process::command(&binary);
            command.args(mpv_args(request, &ipc));
            let child = command
                .spawn()
                .map_err(|_| "mpv launch failed".to_string())?;
            Ok(Box::new(MpvProcess::new(child, ipc)?) as Box<dyn PlayerProcess>)
        })
    }
}

pub fn mpv_args(request: &PlayerOpenRequest, ipc: &str) -> Vec<OsString> {
    let mut args = vec![
        "--idle=yes".into(),
        "--no-terminal".into(),
        "--force-window=yes".into(),
        "--no-config".into(),
        format!("--input-ipc-server={ipc}").into(),
    ];
    if let Some(start_ms) = request.start_ms {
        args.push(format!("--start={}", start_ms as f64 / 1000.0).into());
    }
    if let Some(title) = &request.title {
        args.push(format!("--title={title}").into());
    }
    for (name, value) in request.headers.iter().flatten() {
        args.push(format!("--http-header-fields={name}: {value}").into());
    }
    args.push("--".into());
    args.push(request.url.clone().into());
    args
}

fn ipc_path(_config: &PlayerConfig) -> String {
    #[cfg(windows)]
    {
        format!("omp-mpv-{}", std::process::id())
    }
    #[cfg(not(windows))]
    {
        config
            .data_dir
            .join("mpv-ipc.sock")
            .to_string_lossy()
            .into_owned()
    }
}

fn extract_mpv(archive: &PathBuf, data_dir: &PathBuf) -> Result<PathBuf, String> {
    let executable = data_dir.join("mpv.exe");
    let file = std::fs::File::open(archive).map_err(|_| "mpv archive open failed".to_string())?;
    let mut found = false;
    sevenz_rust::decompress_with_extract_fn(file, data_dir, |entry, reader, path| {
        let name = entry.name();
        if name.is_empty()
            || name.starts_with(['/', '\\'])
            || name.contains(':')
            || name.split(['/', '\\']).any(|part| part == "..")
        {
            return Err(sevenz_rust::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "unsafe archive path",
            )));
        }
        if name.replace('\\', "/").ends_with("mpv.exe") {
            found = true;
        }
        sevenz_rust::default_entry_extract_fn(entry, reader, path)
    })
    .map_err(|_| "mpv extraction failed".to_string())?;
    if !found {
        return Err("mpv executable not found".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755))
            .map_err(|_| "mpv permission update failed".to_string())?;
    }
    Ok(executable)
}

struct MpvProcess {
    child: std::process::Child,
    ipc: MpvIpc,
}

impl MpvProcess {
    fn new(mut child: std::process::Child, ipc: String) -> Result<Self, String> {
        let ipc = match MpvIpc::connect(&ipc) {
            Ok(ipc) => ipc,
            Err(error) => {
                let _ = crate::process::stop(&mut child);
                return Err(error);
            }
        };
        Ok(Self { child, ipc })
    }
}

impl PlayerProcess for MpvProcess {
    fn pause(&mut self, paused: bool) -> Result<(), String> {
        self.ipc.set_pause(paused)
    }

    fn position(&self) -> Result<(u64, u64), String> {
        self.ipc.position()
    }

    fn stop(&mut self) -> Result<(), String> {
        crate::process::stop(&mut self.child).map_err(|_| "mpv stop failed".to_string())
    }

    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        if let Some(status) = self
            .child
            .try_wait()
            .map_err(|_| "mpv status failed".to_string())?
        {
            return Ok(status.code());
        }
        if self.ipc.eof_reached()? {
            return Ok(Some(0));
        }
        Ok(None)
    }
}

struct MpvIpc {
    stream: std::cell::RefCell<Box<dyn crate::process::IpcStream>>,
    next_request_id: std::cell::Cell<u64>,
}

impl MpvIpc {
    fn connect(path: &str) -> Result<Self, String> {
        let mut last_error = None;
        for _ in 0..50 {
            match crate::process::connect_ipc(path) {
                Ok(stream) => {
                    return Ok(Self {
                        stream: std::cell::RefCell::new(stream),
                        next_request_id: std::cell::Cell::new(1),
                    });
                }
                Err(error) => last_error = Some(error),
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        Err(format!(
            "mpv IPC connection failed: {:?}",
            last_error.map(|error| error.kind())
        ))
    }

    fn call(&self, command: serde_json::Value) -> Result<serde_json::Value, String> {
        use std::io::{Read, Write};
        let request_id = self.next_request_id.get();
        self.next_request_id.set(request_id.wrapping_add(1));
        let request = serde_json::json!({ "command": command, "request_id": request_id });
        let mut text =
            serde_json::to_string(&request).map_err(|_| "mpv IPC encode failed".to_string())?;
        text.push('\n');
        let mut stream = self.stream.borrow_mut();
        stream
            .write_all(text.as_bytes())
            .map_err(|_| "mpv IPC write failed".to_string())?;
        stream
            .flush()
            .map_err(|_| "mpv IPC flush failed".to_string())?;
        loop {
            let mut bytes = Vec::new();
            let mut byte = [0_u8; 1];
            loop {
                let count = stream
                    .read(&mut byte)
                    .map_err(|_| "mpv IPC read failed".to_string())?;
                if count == 0 {
                    return Err("mpv IPC closed".to_string());
                }
                if byte[0] == b'\n' {
                    break;
                }
                bytes.push(byte[0]);
            }
            let line = String::from_utf8(bytes)
                .map_err(|_| "mpv IPC response encoding failed".to_string())?;
            let response: serde_json::Value =
                serde_json::from_str(&line).map_err(|_| "mpv IPC response failed".to_string())?;
            if response
                .get("request_id")
                .and_then(serde_json::Value::as_u64)
                != Some(request_id)
            {
                continue;
            }
            if response.get("error").and_then(serde_json::Value::as_str) != Some("success") {
                return Err("mpv command failed".to_string());
            }
            return Ok(response);
        }
    }

    fn number(&self, property: &str) -> Result<f64, String> {
        let response = self.call(serde_json::json!(["get_property", property]))?;
        response
            .get("data")
            .and_then(serde_json::Value::as_f64)
            .ok_or_else(|| "mpv property is unavailable".to_string())
    }

    fn boolean(&self, property: &str) -> Result<bool, String> {
        let response = self.call(serde_json::json!(["get_property", property]))?;
        response
            .get("data")
            .and_then(serde_json::Value::as_bool)
            .ok_or_else(|| "mpv property is unavailable".to_string())
    }

    fn eof_reached(&self) -> Result<bool, String> {
        self.boolean("eof-reached")
    }

    fn set_pause(&mut self, paused: bool) -> Result<(), String> {
        self.call(serde_json::json!(["set_property", "pause", paused]))
            .map(|_| ())
    }

    fn position(&self) -> Result<(u64, u64), String> {
        let position = self.number("time-pos")?;
        let duration = self.number("duration")?;
        Ok(((position * 1000.0) as u64, (duration * 1000.0) as u64))
    }
}

#[cfg(test)]
mod tests;
