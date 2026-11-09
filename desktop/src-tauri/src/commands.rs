use crate::platform;
use crate::server::{ServerHandle, ServerManager, ServerStartRequest};
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub fn health() -> &'static str {
    "ok"
}

#[tauri::command]
pub fn target_platform() -> Result<platform::TargetPlatform, String> {
    platform::current()
}

#[tauri::command]
pub fn server_start(
    request: ServerStartRequest,
    state: State<'_, Mutex<ServerManager>>,
) -> Result<ServerHandle, String> {
    state
        .lock()
        .map_err(|_| "server state lock failed".to_string())
        .map(|mut manager| manager.start(request))
}

#[tauri::command]
pub fn server_stop(state: State<'_, Mutex<ServerManager>>) -> Result<ServerHandle, String> {
    state
        .lock()
        .map_err(|_| "server state lock failed".to_string())
        .map(|mut manager| manager.stop())
}

#[tauri::command]
pub fn server_status(state: State<'_, Mutex<ServerManager>>) -> Result<ServerHandle, String> {
    state
        .lock()
        .map_err(|_| "server state lock failed".to_string())
        .map(|mut manager| manager.status())
}

#[tauri::command]
pub fn server_update(state: State<'_, Mutex<ServerManager>>) -> Result<ServerHandle, String> {
    state
        .lock()
        .map_err(|_| "server state lock failed".to_string())
        .map(|mut manager| manager.update())
}
