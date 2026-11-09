use crate::player::{PlayerCancellation, PlayerManager};
use crate::server::ServerManager;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, RunEvent, Runtime};

pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: RunEvent) {
    if let RunEvent::ExitRequested { .. } = event {
        shutdown(app);
    }
}

pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let server = app.try_state::<Arc<Mutex<ServerManager>>>();
    let player = app.try_state::<Arc<Mutex<PlayerManager>>>();
    let cancellation = app.try_state::<PlayerCancellation>();
    if let (Some(server), Some(player), Some(cancellation)) = (server, player, cancellation) {
        stop_processes(server.inner(), player.inner(), cancellation.inner());
    }
}

pub fn stop_processes(
    server: &Arc<Mutex<ServerManager>>,
    player: &Arc<Mutex<PlayerManager>>,
    cancellation: &PlayerCancellation,
) {
    cancellation.cancel();
    if let Ok(mut manager) = server.lock() {
        manager.stop();
    }
    if let Ok(mut manager) = player.lock() {
        manager.stop();
    }
}

#[cfg(test)]
mod tests;
