use crate::download::installed_verified;
use crate::http::{HttpClient, HttpResponse, NativeHttpRequest};
use crate::platform;
use crate::player::{PlayerManager, PlayerOpenRequest, PlayerStatus};
use crate::server::{ServerHandle, ServerManager, ServerStartRequest};
use std::sync::{Arc, Mutex};
use tauri::State;

async fn run_server<F>(
    state: Arc<Mutex<ServerManager>>,
    operation: F,
) -> Result<ServerHandle, String>
where
    F: FnOnce(&mut ServerManager) -> ServerHandle + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let mut manager = state
            .lock()
            .map_err(|_| "server state lock failed".to_string())?;
        Ok(operation(&mut manager))
    })
    .await
    .map_err(|error| format!("server worker failed: {error}"))?
}

#[tauri::command]
pub fn health() -> &'static str {
    "ok"
}

#[tauri::command]
pub fn target_platform() -> Result<platform::TargetPlatform, String> {
    platform::current()
}

#[tauri::command]
pub async fn server_start(
    request: ServerStartRequest,
    state: State<'_, Arc<Mutex<ServerManager>>>,
) -> Result<ServerHandle, String> {
    run_server(Arc::clone(state.inner()), move |manager| {
        manager.start(request)
    })
    .await
}

#[tauri::command]
pub async fn server_stop(
    state: State<'_, Arc<Mutex<ServerManager>>>,
) -> Result<ServerHandle, String> {
    run_server(Arc::clone(state.inner()), |manager| manager.stop()).await
}

#[tauri::command]
pub async fn server_status(
    state: State<'_, Arc<Mutex<ServerManager>>>,
) -> Result<ServerHandle, String> {
    run_server(Arc::clone(state.inner()), |manager| manager.status()).await
}

#[tauri::command]
pub async fn server_update(
    state: State<'_, Arc<Mutex<ServerManager>>>,
) -> Result<ServerHandle, String> {
    run_server(Arc::clone(state.inner()), |manager| manager.update()).await
}

#[cfg(test)]
mod tests {
    use super::{run_server, ServerManager};
    use crate::server::{ServerConfig, ServerError, ServerMode, ServerStartRequest, ServerStatus};
    use std::sync::{Arc, Mutex};
    use std::thread::{self, ThreadId};

    #[test]
    fn start_and_update_work_runs_off_calling_thread() {
        let caller = thread::current().id();
        let workers = Arc::new(Mutex::new(Vec::<ThreadId>::new()));
        let workers_in_launcher = Arc::clone(&workers);
        let temp = tempfile::tempdir().expect("temp directory");
        let manager = ServerManager::with_launcher(ServerConfig::new(temp.path()), move |_| {
            workers_in_launcher
                .lock()
                .expect("worker IDs")
                .push(thread::current().id());
            Err(ServerError::Launch("stop after thread check".to_string()))
        });
        let state = Arc::new(Mutex::new(manager));

        let handles = tauri::async_runtime::block_on(async {
            let started = run_server(Arc::clone(&state), |manager| {
                manager.start(ServerStartRequest {
                    mode: ServerMode::Embedded,
                    origin: None,
                })
            })
            .await?;
            let updated = run_server(state, |manager| manager.update()).await?;
            Ok::<Vec<_>, String>(vec![started, updated])
        })
        .expect("worker results");

        assert!(handles
            .iter()
            .all(|handle| handle.status == ServerStatus::Error));
        let workers = workers.lock().expect("worker IDs");
        assert_eq!(workers.len(), 2);
        assert!(workers.iter().all(|worker| *worker != caller));
    }
}

#[tauri::command]
pub async fn native_http(
    request: NativeHttpRequest,
    state: State<'_, HttpClient>,
) -> Result<HttpResponse, String> {
    let client = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || client.request(request))
        .await
        .map_err(|error| format!("HTTP worker failed: {error}"))?
}

#[tauri::command]
pub async fn native_http_clear_cookies(
    url: String,
    state: State<'_, HttpClient>,
) -> Result<(), String> {
    let client = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || client.clear_cookies(&url))
        .await
        .map_err(|error| format!("HTTP worker failed: {error}"))?
}

#[tauri::command]
pub async fn server_binary_installed() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let target = platform::current()?;
        let asset = platform::asset_for(target).map_err(|error| error.to_string())?;
        installed_verified(asset).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("binary state worker failed: {error}"))?
}

async fn run_player<F>(
    state: Arc<Mutex<PlayerManager>>,
    operation: F,
) -> Result<PlayerStatus, String>
where
    F: FnOnce(&mut PlayerManager) -> PlayerStatus + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let mut manager = state
            .lock()
            .map_err(|_| "player state lock failed".to_string())?;
        Ok(operation(&mut manager))
    })
    .await
    .map_err(|error| format!("player worker failed: {error}"))?
}

#[tauri::command]
pub async fn player_open(
    request: PlayerOpenRequest,
    state: State<'_, Arc<Mutex<PlayerManager>>>,
) -> Result<PlayerStatus, String> {
    run_player(Arc::clone(state.inner()), move |manager| {
        manager.open(request)
    })
    .await
}

#[tauri::command]
pub async fn player_pause(
    state: State<'_, Arc<Mutex<PlayerManager>>>,
) -> Result<PlayerStatus, String> {
    run_player(Arc::clone(state.inner()), |manager| manager.pause()).await
}

#[tauri::command]
pub async fn player_stop(
    state: State<'_, Arc<Mutex<PlayerManager>>>,
) -> Result<PlayerStatus, String> {
    run_player(Arc::clone(state.inner()), |manager| manager.stop()).await
}

#[tauri::command]
pub async fn player_status(
    state: State<'_, Arc<Mutex<PlayerManager>>>,
) -> Result<PlayerStatus, String> {
    run_player(Arc::clone(state.inner()), |manager| manager.status()).await
}
