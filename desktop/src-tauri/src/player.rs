use crate::download::{download_verified, DownloadError};
use crate::platform::current;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

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

#[derive(Clone, Debug)]
pub struct PlayerCancellation {
    generation: std::sync::Arc<std::sync::atomic::AtomicU64>,
    notify: std::sync::Arc<(std::sync::Mutex<()>, std::sync::Condvar)>,
}

impl PlayerCancellation {
    pub fn new() -> Self {
        Self {
            generation: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
            notify: std::sync::Arc::new((std::sync::Mutex::new(()), std::sync::Condvar::new())),
        }
    }

    pub fn cancel(&self) -> u64 {
        let generation = self
            .generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;
        let (lock, condition) = &*self.notify;
        let _guard = lock.lock().expect("cancellation lock");
        condition.notify_all();
        generation
    }

    pub fn current(&self) -> u64 {
        self.generation.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn is_cancelled(&self, generation: u64) -> bool {
        self.current() != generation
    }

    pub fn wait_cancelled(&self, generation: u64, timeout: std::time::Duration) -> bool {
        let (lock, condition) = &*self.notify;
        let mut guard = lock.lock().expect("cancellation lock");
        let deadline = std::time::Instant::now() + timeout;
        while !self.is_cancelled(generation) {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return false;
            }
            let (next, wait) = condition
                .wait_timeout(guard, remaining)
                .expect("cancellation wait");
            guard = next;
            if wait.timed_out() {
                return self.is_cancelled(generation);
            }
        }
        true
    }
}

pub trait PlayerProcess: Send {
    fn wait_until_loaded(
        &mut self,
        _cancellation: &PlayerCancellation,
        _generation: u64,
    ) -> Result<(), String> {
        Ok(())
    }
    fn pause(&mut self, paused: bool) -> Result<(), String>;
    fn pause_cancelled(
        &mut self,
        paused: bool,
        _cancellation: &PlayerCancellation,
        _generation: u64,
    ) -> Result<(), String> {
        self.pause(paused)
    }
    fn pause_state(&self) -> Result<Option<bool>, String> {
        Ok(None)
    }
    fn pause_state_cancelled(
        &self,
        _cancellation: &PlayerCancellation,
        _generation: u64,
    ) -> Result<Option<bool>, String> {
        self.pause_state()
    }
    fn position(&self) -> Result<(u64, u64), String>;
    fn position_cancelled(
        &self,
        _cancellation: &PlayerCancellation,
        _generation: u64,
    ) -> Result<(u64, u64), String> {
        self.position()
    }
    fn stop(&mut self) -> Result<(), String>;
    fn try_wait(&mut self) -> Result<Option<i32>, String>;
    fn try_wait_cancelled(
        &mut self,
        _cancellation: &PlayerCancellation,
        _generation: u64,
    ) -> Result<Option<i32>, String> {
        self.try_wait()
    }
    fn input(&mut self, _args: &[&str]) -> Result<(), String> {
        Err("player input is unavailable".to_string())
    }
}

type Launcher =
    dyn Fn(&PlayerOpenRequest) -> Result<Box<dyn PlayerProcess>, String> + Send + Sync + 'static;

pub struct PlayerManager {
    status: PlayerStatus,
    process: Option<Box<dyn PlayerProcess>>,
    launcher: Box<Launcher>,
    cancellation: PlayerCancellation,
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
            cancellation: PlayerCancellation::new(),
        }
    }

    pub fn cancellation(&self) -> PlayerCancellation {
        self.cancellation.clone()
    }

    pub fn open(&mut self, request: PlayerOpenRequest) -> PlayerStatus {
        let generation = self.cancellation.cancel();
        self.open_at(request, generation)
    }

    pub fn open_at(&mut self, request: PlayerOpenRequest, generation: u64) -> PlayerStatus {
        if self.cancellation.is_cancelled(generation) {
            return self.status.clone();
        }
        self.stop_process();
        if self.cancellation.is_cancelled(generation) {
            return self.status.clone();
        }
        self.status.state = PlayerState::Starting;
        match (self.launcher)(&request) {
            Ok(mut process) => match process.wait_until_loaded(&self.cancellation, generation) {
                Ok(()) => {
                    self.process = Some(process);
                    self.status.state = PlayerState::Playing;
                }
                Err(_) => {
                    let _ = process.stop();
                    let cancelled = self.cancellation.is_cancelled(generation);
                    self.status = PlayerStatus {
                        state: if cancelled {
                            PlayerState::Idle
                        } else {
                            PlayerState::Error
                        },
                        position_ms: 0,
                        duration_ms: 0,
                        error: if cancelled {
                            None
                        } else {
                            Some("player launch failed".to_string())
                        },
                    };
                }
            },
            Err(_) => {
                let cancelled = self.cancellation.is_cancelled(generation);
                self.status = PlayerStatus {
                    state: if cancelled {
                        PlayerState::Idle
                    } else {
                        PlayerState::Error
                    },
                    position_ms: 0,
                    duration_ms: 0,
                    error: if cancelled {
                        None
                    } else {
                        Some("player launch failed".to_string())
                    },
                }
            }
        }
        self.status.clone()
    }

    pub fn pause(&mut self) -> PlayerStatus {
        let generation = self.cancellation.current();
        let Some(process) = self.process.as_mut() else {
            return self.status.clone();
        };
        if !matches!(
            self.status.state,
            PlayerState::Playing | PlayerState::Paused
        ) {
            return self.status.clone();
        }
        match process.pause_state_cancelled(&self.cancellation, generation) {
            Ok(Some(actual)) => {
                self.status.state = if actual {
                    PlayerState::Paused
                } else {
                    PlayerState::Playing
                };
            }
            Ok(None) => {}
            Err(_) if self.cancellation.is_cancelled(generation) => {
                return self.status.clone();
            }
            Err(_) => {
                self.status.error = Some("player pause failed".to_string());
                return self.status.clone();
            }
        }
        let paused = match self.status.state {
            PlayerState::Playing => true,
            PlayerState::Paused => false,
            _ => return self.status.clone(),
        };
        match process.pause_cancelled(paused, &self.cancellation, generation) {
            Ok(()) => {
                self.status.state = if paused {
                    PlayerState::Paused
                } else {
                    PlayerState::Playing
                };
            }
            Err(_) if self.cancellation.is_cancelled(generation) => {}
            Err(_) => self.status.error = Some("player pause failed".to_string()),
        }
        self.status.clone()
    }

    pub fn control(&mut self, action: &str) -> Result<PlayerStatus, String> {
        if action == "pause" {
            return Ok(self.pause());
        }
        let Some(process) = self.process.as_mut() else {
            return Err("player is idle".to_string());
        };
        let result = match action {
            "seek-back" => process.input(&["seek", "-10", "relative"]),
            "seek-forward" => process.input(&["seek", "10", "relative"]),
            "volume-down" => process.input(&["add", "volume", "-5"]),
            "volume-up" => process.input(&["add", "volume", "5"]),
            "fullscreen" => process.input(&["cycle", "fullscreen"]),
            _ => Err("unknown player action".to_string()),
        };
        result.map(|_| self.status.clone())
    }

    pub fn stop(&mut self) -> PlayerStatus {
        self.cancellation.cancel();
        self.stop_process()
    }

    pub fn stop_at(&mut self, generation: u64) -> PlayerStatus {
        if self.cancellation.is_cancelled(generation) {
            return self.status.clone();
        }
        self.stop_process()
    }

    fn stop_process(&mut self) -> PlayerStatus {
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
        let generation = self.cancellation.current();
        let Some(process) = self.process.as_mut() else {
            return self.status.clone();
        };
        match process.try_wait_cancelled(&self.cancellation, generation) {
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
            Ok(None) => {
                match process.pause_state_cancelled(&self.cancellation, generation) {
                    Ok(Some(actual)) => {
                        self.status.state = if actual {
                            PlayerState::Paused
                        } else {
                            PlayerState::Playing
                        };
                    }
                    Ok(None) => {}
                    Err(_) if self.cancellation.is_cancelled(generation) => {
                        return self.status.clone();
                    }
                    Err(_) => self.status.error = Some("player status failed".to_string()),
                }
                match process.position_cancelled(&self.cancellation, generation) {
                    Ok((position, duration)) => {
                        self.status.position_ms = position;
                        self.status.duration_ms = duration;
                    }
                    Err(_) if self.cancellation.is_cancelled(generation) => {
                        return self.status.clone();
                    }
                    Err(_) => self.status.error = Some("player status failed".to_string()),
                }
            }
            Err(_) if self.cancellation.is_cancelled(generation) => return self.status.clone(),
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
            let mut process = MpvProcess::new(child, ipc)?;
            if let Err(error) = process.load(&request.url) {
                let _ = process.stop();
                return Err(error);
            }
            Ok(Box::new(process) as Box<dyn PlayerProcess>)
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
    args
}

fn ipc_path(config: &PlayerConfig) -> String {
    #[cfg(windows)]
    {
        let _ = config;
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

fn is_mpv_file(name: &str) -> bool {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    base == "mpv" || base == "mpv.exe"
}

fn safe_archive_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(['/', '\\'])
        && !name.contains(':')
        && !name.split(['/', '\\']).any(|part| part == "..")
}

fn mark_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|_| "mpv permission update failed".to_string())?;
    }
    let _ = path;
    Ok(())
}

fn extract_mpv(archive: &PathBuf, data_dir: &PathBuf) -> Result<PathBuf, String> {
    std::fs::create_dir_all(data_dir).map_err(|_| "mpv directory failed".to_string())?;
    let name = archive
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if name.ends_with(".AppImage") {
        let dest = data_dir.join("mpv");
        std::fs::copy(archive, &dest).map_err(|_| "mpv copy failed".to_string())?;
        mark_executable(&dest)?;
        return Ok(dest);
    }
    if name.ends_with(".zip") {
        return extract_mpv_zip(archive, data_dir);
    }
    extract_mpv_7z(archive, data_dir)
}

fn extract_mpv_7z(archive: &Path, data_dir: &Path) -> Result<PathBuf, String> {
    let file = std::fs::File::open(archive).map_err(|_| "mpv archive open failed".to_string())?;
    let mut found = false;
    sevenz_rust::decompress_with_extract_fn(file, data_dir, |entry, reader, path| {
        let name = entry.name();
        if !safe_archive_name(name) {
            return Err(sevenz_rust::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "unsafe archive path",
            )));
        }
        if is_mpv_file(name) {
            found = true;
        }
        sevenz_rust::default_entry_extract_fn(entry, reader, path)
    })
    .map_err(|_| "mpv extraction failed".to_string())?;
    if !found {
        return Err("mpv executable not found".to_string());
    }
    let executable = data_dir.join("mpv.exe");
    mark_executable(&executable)?;
    Ok(executable)
}

fn extract_mpv_zip(archive: &Path, data_dir: &Path) -> Result<PathBuf, String> {
    let file = std::fs::File::open(archive).map_err(|_| "mpv archive open failed".to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "mpv archive open failed".to_string())?;
    let mut tar_bytes = Vec::new();
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|_| "mpv archive open failed".to_string())?;
        let name = entry.name().to_string();
        if !safe_archive_name(&name) {
            return Err("mpv archive path rejected".to_string());
        }
        if name.rsplit(['/', '\\']).next() == Some("mpv.tar.gz") {
            std::io::copy(&mut entry, &mut tar_bytes)
                .map_err(|_| "mpv archive read failed".to_string())?;
            break;
        }
    }
    if tar_bytes.is_empty() {
        return Err("mpv executable not found".to_string());
    }
    let decoder = flate2::read::GzDecoder::new(std::io::Cursor::new(tar_bytes));
    let mut tar = tar::Archive::new(decoder);
    let entries = tar.entries().map_err(|_| "mpv extraction failed".to_string())?;
    for entry in entries {
        let mut entry = entry.map_err(|_| "mpv extraction failed".to_string())?;
        let path = entry
            .path()
            .map_err(|_| "mpv extraction failed".to_string())?
            .into_owned();
        if !safe_archive_name(&path.to_string_lossy()) {
            return Err("mpv archive path rejected".to_string());
        }
        let dest = data_dir.join(&path);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&dest).map_err(|_| "mpv extraction failed".to_string())?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "mpv extraction failed".to_string())?;
        }
        entry
            .unpack(&dest)
            .map_err(|_| "mpv extraction failed".to_string())?;
    }
    let executable = data_dir.join("mpv.app/Contents/MacOS/mpv");
    if !executable.is_file() {
        return Err("mpv executable not found".to_string());
    }
    mark_executable(&executable)?;
    Ok(executable)
}

struct MpvProcess {
    child: std::process::Child,
    ipc: MpvIpcWorker,
}

impl MpvProcess {
    fn new(mut child: std::process::Child, ipc: String) -> Result<Self, String> {
        let ipc = match MpvIpc::connect(&ipc) {
            Ok(ipc) => ipc.spawn(std::time::Duration::from_secs(2)),
            Err(error) => {
                let _ = crate::process::stop(&mut child);
                return Err(error);
            }
        };
        Ok(Self { child, ipc })
    }

    fn load(&self, url: &str) -> Result<(), String> {
        self.ipc
            .call(serde_json::json!(["loadfile", url]))
            .map(|_| ())
    }

    fn input_args(&self, args: &[&str]) -> Result<(), String> {
        let command = serde_json::Value::Array(
            args.iter()
                .copied()
                .map(|arg| serde_json::Value::String(arg.to_string()))
                .collect(),
        );
        self.ipc.call(command).map(|_| ())
    }
}

impl PlayerProcess for MpvProcess {
    fn wait_until_loaded(
        &mut self,
        cancellation: &PlayerCancellation,
        generation: u64,
    ) -> Result<(), String> {
        loop {
            if cancellation.is_cancelled(generation) {
                return Err("player open cancelled".to_string());
            }
            if self
                .ipc
                .media_error
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                return Err("mpv media load failed".to_string());
            }
            if self
                .child
                .try_wait()
                .map_err(|_| "mpv status failed".to_string())?
                .is_some()
            {
                return Err("mpv media load failed".to_string());
            }
            match self
                .ipc
                .call(serde_json::json!(["get_property", "playback-time"]))
            {
                Ok(response)
                    if response
                        .get("data")
                        .and_then(serde_json::Value::as_f64)
                        .is_some() =>
                {
                    return Ok(());
                }
                Ok(_) => {}
                Err(error) if error == "mpv command failed" => {}
                Err(error) => return Err(error),
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    fn pause(&mut self, paused: bool) -> Result<(), String> {
        self.ipc.set_pause(paused)
    }

    fn input(&mut self, args: &[&str]) -> Result<(), String> {
        self.input_args(args)
    }

    fn pause_cancelled(
        &mut self,
        paused: bool,
        cancellation: &PlayerCancellation,
        generation: u64,
    ) -> Result<(), String> {
        self.ipc
            .set_pause_cancelled(paused, cancellation, generation)
    }

    fn pause_state(&self) -> Result<Option<bool>, String> {
        self.ipc.boolean("pause").map(Some)
    }

    fn pause_state_cancelled(
        &self,
        cancellation: &PlayerCancellation,
        generation: u64,
    ) -> Result<Option<bool>, String> {
        self.ipc
            .boolean_cancelled("pause", cancellation, generation)
            .map(Some)
    }

    fn position(&self) -> Result<(u64, u64), String> {
        self.ipc.position()
    }

    fn position_cancelled(
        &self,
        cancellation: &PlayerCancellation,
        generation: u64,
    ) -> Result<(u64, u64), String> {
        let position = self
            .ipc
            .number_cancelled("time-pos", cancellation, generation)?;
        let duration = self
            .ipc
            .number_cancelled("duration", cancellation, generation)?;
        Ok(((position * 1000.0) as u64, (duration * 1000.0) as u64))
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

    fn try_wait_cancelled(
        &mut self,
        cancellation: &PlayerCancellation,
        generation: u64,
    ) -> Result<Option<i32>, String> {
        if let Some(status) = self
            .child
            .try_wait()
            .map_err(|_| "mpv status failed".to_string())?
        {
            return Ok(status.code());
        }
        if self
            .ipc
            .boolean_cancelled("eof-reached", cancellation, generation)?
        {
            return Ok(Some(0));
        }
        Ok(None)
    }
}

struct MpvIpcWorker {
    requests: std::sync::mpsc::Sender<IpcRequest>,
    timeout: std::time::Duration,
    media_error: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

struct IpcRequest {
    command: serde_json::Value,
    response: std::sync::mpsc::Sender<Result<serde_json::Value, String>>,
}

trait IpcCall {
    fn call(&self, command: serde_json::Value) -> Result<serde_json::Value, String>;

    fn call_cancelled(
        &self,
        command: serde_json::Value,
        _cancellation: &PlayerCancellation,
        _generation: u64,
    ) -> Result<serde_json::Value, String> {
        self.call(command)
    }

    fn number(&self, property: &str) -> Result<f64, String> {
        let response = self.call(serde_json::json!(["get_property", property]))?;
        response
            .get("data")
            .and_then(serde_json::Value::as_f64)
            .ok_or_else(|| "mpv property is unavailable".to_string())
    }

    fn number_cancelled(
        &self,
        property: &str,
        cancellation: &PlayerCancellation,
        generation: u64,
    ) -> Result<f64, String> {
        let response = self.call_cancelled(
            serde_json::json!(["get_property", property]),
            cancellation,
            generation,
        )?;
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

    fn boolean_cancelled(
        &self,
        property: &str,
        cancellation: &PlayerCancellation,
        generation: u64,
    ) -> Result<bool, String> {
        let response = self.call_cancelled(
            serde_json::json!(["get_property", property]),
            cancellation,
            generation,
        )?;
        response
            .get("data")
            .and_then(serde_json::Value::as_bool)
            .ok_or_else(|| "mpv property is unavailable".to_string())
    }

    fn eof_reached(&self) -> Result<bool, String> {
        self.boolean("eof-reached")
    }

    fn set_pause(&self, paused: bool) -> Result<(), String> {
        self.call(serde_json::json!(["set_property", "pause", paused]))
            .map(|_| ())
    }

    fn set_pause_cancelled(
        &self,
        paused: bool,
        cancellation: &PlayerCancellation,
        generation: u64,
    ) -> Result<(), String> {
        self.call_cancelled(
            serde_json::json!(["set_property", "pause", paused]),
            cancellation,
            generation,
        )
        .map(|_| ())
    }

    fn position(&self) -> Result<(u64, u64), String> {
        let position = self.number("time-pos")?;
        let duration = self.number("duration")?;
        Ok(((position * 1000.0) as u64, (duration * 1000.0) as u64))
    }
}

impl IpcCall for MpvIpcWorker {
    fn call(&self, command: serde_json::Value) -> Result<serde_json::Value, String> {
        let (response, receiver) = std::sync::mpsc::channel();
        self.requests
            .send(IpcRequest { command, response })
            .map_err(|_| "mpv IPC closed".to_string())?;
        match receiver.recv_timeout(self.timeout) {
            Ok(result) => result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                Err("mpv IPC reply timeout".to_string())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                Err("mpv IPC closed".to_string())
            }
        }
    }

    fn call_cancelled(
        &self,
        command: serde_json::Value,
        cancellation: &PlayerCancellation,
        generation: u64,
    ) -> Result<serde_json::Value, String> {
        let (response, receiver) = std::sync::mpsc::channel();
        self.requests
            .send(IpcRequest { command, response })
            .map_err(|_| "mpv IPC closed".to_string())?;
        let deadline = std::time::Instant::now() + self.timeout;
        loop {
            if cancellation.is_cancelled(generation) {
                return Err("mpv IPC cancelled".to_string());
            }
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err("mpv IPC reply timeout".to_string());
            }
            match receiver.recv_timeout(remaining.min(std::time::Duration::from_millis(25))) {
                Ok(result) => return result,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("mpv IPC closed".to_string());
                }
            }
        }
    }
}

struct MpvIpc {
    stream: std::cell::RefCell<Box<dyn crate::process::IpcStream>>,
    next_request_id: std::cell::Cell<u64>,
    media_error: std::sync::Arc<std::sync::atomic::AtomicBool>,
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
                        media_error: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
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

    fn spawn(self, timeout: std::time::Duration) -> MpvIpcWorker {
        let (requests, receiver) = std::sync::mpsc::channel::<IpcRequest>();
        let media_error = std::sync::Arc::clone(&self.media_error);
        std::thread::spawn(move || {
            while let Ok(request) = receiver.recv() {
                let result = self.call(request.command);
                let _ = request.response.send(result);
            }
        });
        MpvIpcWorker {
            requests,
            timeout,
            media_error,
        }
    }
}

impl IpcCall for MpvIpc {
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
            if response.get("event").and_then(serde_json::Value::as_str) == Some("end-file")
                && response.get("reason").and_then(serde_json::Value::as_str) == Some("error")
            {
                self.media_error
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            }
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
}

#[cfg(test)]
mod tests;
