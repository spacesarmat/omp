use super::stop_processes;
use crate::player::{
    PlayerCancellation, PlayerManager, PlayerOpenRequest, PlayerProcess, PlayerState,
};
use crate::server::{ServerConfig, ServerManager, ServerMode, ServerStartRequest, ServerStatus};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind free port")
        .local_addr()
        .expect("free port address")
        .port()
}

fn config(data_dir: &std::path::Path, port: u16) -> ServerConfig {
    ServerConfig {
        origin: format!("http://127.0.0.1:{port}"),
        port,
        startup_timeout: Duration::from_secs(5),
        ..ServerConfig::new(data_dir)
    }
}

fn embedded() -> ServerStartRequest {
    ServerStartRequest {
        mode: ServerMode::Embedded,
        origin: None,
    }
}

fn echo_launcher(config: &ServerConfig) -> Result<std::process::Child, crate::server::ServerError> {
    let executable = std::env::current_exe().expect("current test executable");
    crate::process::command(&executable)
        .args(["--exact", "server::tests::child_entrypoint", "--nocapture"])
        .env("OMP_SERVER_TEST_CHILD", "echo")
        .env("OMP_SERVER_TEST_PORT", config.port.to_string())
        .spawn()
        .map_err(crate::server::ServerError::Io)
}

fn port_open(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok()
}

fn wait_for(mut condition: impl FnMut() -> bool) {
    for _ in 0..100 {
        if condition() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("condition was not met in time");
}

struct FakeProcess {
    stopped: Arc<AtomicBool>,
}

impl PlayerProcess for FakeProcess {
    fn pause(&mut self, paused: bool) -> Result<(), String> {
        let _ = paused;
        Ok(())
    }

    fn position(&self) -> Result<(u64, u64), String> {
        Ok((0, 0))
    }

    fn stop(&mut self) -> Result<(), String> {
        self.stopped.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        Ok(None)
    }
}

fn player_manager(stopped: &Arc<AtomicBool>) -> PlayerManager {
    let stopped_in_launcher = Arc::clone(stopped);
    PlayerManager::with_launcher(move |_| {
        Ok(Box::new(FakeProcess {
            stopped: Arc::clone(&stopped_in_launcher),
        }))
    })
}

fn player_request() -> PlayerOpenRequest {
    PlayerOpenRequest {
        url: "http://127.0.0.1:8090/stream".to_string(),
        title: None,
        headers: None,
        start_ms: None,
    }
}

#[test]
fn exit_shutdown_stops_embedded_server_process() {
    let temp = tempfile::tempdir().expect("temp directory");
    let port = free_port();
    let server = Arc::new(Mutex::new(ServerManager::with_launcher(
        config(temp.path(), port),
        echo_launcher,
    )));
    let player_stopped = Arc::new(AtomicBool::new(false));
    let player = Arc::new(Mutex::new(player_manager(&player_stopped)));
    let cancellation = PlayerCancellation::new();
    let handle = {
        let mut guard = server.lock().expect("server lock");
        guard.start(embedded())
    };
    assert_eq!(
        handle.status,
        ServerStatus::Ready,
        "{}",
        handle.error.as_deref().unwrap_or("")
    );
    assert!(port_open(port));

    stop_processes(&server, &player, &cancellation);

    wait_for(|| !port_open(port));
    assert!(!player_stopped.load(Ordering::SeqCst));
}

#[test]
fn exit_shutdown_stops_player_process() {
    let server_stopped_port = free_port();
    let temp = tempfile::tempdir().expect("temp directory");
    let server = Arc::new(Mutex::new(ServerManager::with_launcher(
        config(temp.path(), server_stopped_port),
        echo_launcher,
    )));
    let player_stopped = Arc::new(AtomicBool::new(false));
    let player = Arc::new(Mutex::new(player_manager(&player_stopped)));
    let cancellation = PlayerCancellation::new();
    let status = {
        let mut guard = player.lock().expect("player lock");
        guard.open(player_request())
    };
    assert_eq!(status.state, PlayerState::Playing);

    stop_processes(&server, &player, &cancellation);

    assert!(player_stopped.load(Ordering::SeqCst));
}

#[test]
fn exit_shutdown_cancels_pending_player_open() {
    let temp = tempfile::tempdir().expect("temp directory");
    let port = free_port();
    let server = Arc::new(Mutex::new(ServerManager::with_launcher(
        config(temp.path(), port),
        echo_launcher,
    )));
    let player_stopped = Arc::new(AtomicBool::new(false));
    let player = Arc::new(Mutex::new(player_manager(&player_stopped)));
    let cancellation = PlayerCancellation::new();
    let generation = cancellation.cancel();

    stop_processes(&server, &player, &cancellation);

    assert!(cancellation.is_cancelled(generation));
}
