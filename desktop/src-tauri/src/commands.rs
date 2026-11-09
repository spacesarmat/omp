use crate::platform;

#[tauri::command]
pub fn health() -> &'static str {
    "ok"
}

#[tauri::command]
pub fn target_platform() -> Result<platform::TargetPlatform, String> {
    platform::current()
}
