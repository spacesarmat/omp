use crate::player::{PlayerCancellation, PlayerManager};
use crate::server::{ServerCancellation, ServerManager};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, RunEvent, Runtime};

const LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(2);

pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: RunEvent) {
    if let RunEvent::ExitRequested { .. } = event {
        shutdown(app);
    }
}

pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let server = app.try_state::<Arc<Mutex<ServerManager>>>();
    let player = app.try_state::<Arc<Mutex<PlayerManager>>>();
    let server_cancellation = app.try_state::<ServerCancellation>();
    let player_cancellation = app.try_state::<PlayerCancellation>();
    if let (Some(server), Some(player), Some(server_cancellation), Some(player_cancellation)) =
        (server, player, server_cancellation, player_cancellation)
    {
        stop_processes(
            server.inner(),
            player.inner(),
            server_cancellation.inner(),
            player_cancellation.inner(),
        );
    }
}

pub fn stop_processes(
    server: &Arc<Mutex<ServerManager>>,
    player: &Arc<Mutex<PlayerManager>>,
    server_cancellation: &ServerCancellation,
    player_cancellation: &PlayerCancellation,
) {
    server_cancellation.shutdown();
    player_cancellation.cancel();
    if let Some(mut manager) = lock_within(server, LOCK_WAIT_TIMEOUT) {
        manager.stop();
    }
    if let Some(mut manager) = lock_within(player, LOCK_WAIT_TIMEOUT) {
        manager.stop();
    }
}

fn lock_within<T>(mutex: &Mutex<T>, timeout: Duration) -> Option<MutexGuard<'_, T>> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(guard) = mutex.try_lock() {
            return Some(guard);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
mod tests;
