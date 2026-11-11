use super::{
    health, torrserver_args, ServerConfig, ServerError, ServerManager, ServerMode,
    ServerStartRequest, ServerStatus,
};
use crate::http_test;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::process::Child;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
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
        startup_timeout: Duration::from_secs(2),
        ..ServerConfig::new(data_dir)
    }
}

fn embedded() -> ServerStartRequest {
    ServerStartRequest {
        mode: ServerMode::Embedded,
        origin: None,
    }
}

fn child_launcher_with_role(config: &ServerConfig, role: &str) -> Result<Child, ServerError> {
    let executable = std::env::current_exe().expect("current test executable");
    crate::process::command(&executable)
        .args(["--exact", "server::tests::child_entrypoint", "--nocapture"])
        .env("OMP_SERVER_TEST_CHILD", role)
        .env("OMP_SERVER_TEST_PORT", config.port.to_string())
        .spawn()
        .map_err(ServerError::Io)
}

fn child_launcher(_port: u16) -> impl Fn(&ServerConfig) -> Result<Child, ServerError> {
    move |config| child_launcher_with_role(config, "echo")
}

fn child_launcher_silent(config: &ServerConfig) -> Result<Child, ServerError> {
    child_launcher_with_role(config, "silent")
}

fn port_open(port: u16) -> bool {
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    std::net::TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok()
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

#[test]
fn child_entrypoint() {
    let Ok(role) = std::env::var("OMP_SERVER_TEST_CHILD") else {
        return;
    };
    if role == "exit" {
        return;
    }
    let port = std::env::var("OMP_SERVER_TEST_PORT")
        .expect("child port")
        .parse::<u16>()
        .expect("numeric child port");
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("bind child server");
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request);
        if role == "silent" {
            std::thread::sleep(Duration::from_secs(30));
            continue;
        }
        let body = b"MatriX.test";
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(body);
    }
}

#[test]
fn embedded_start_health_stop() {
    let temp = tempfile::tempdir().expect("temp directory");
    let port = free_port();
    let origin = format!("http://127.0.0.1:{port}");
    let mut manager = ServerManager::with_launcher(config(temp.path(), port), child_launcher(port));

    let handle = manager.start(embedded());
    assert_eq!(
        handle.status,
        ServerStatus::Ready,
        "{}",
        handle.error.as_deref().unwrap_or("")
    );
    assert_eq!(handle.origin, origin);
    assert!(health(&origin));

    let stopped = manager.stop();
    assert_eq!(stopped.status, ServerStatus::Stopped);
    assert!(!health(&origin));
}

#[test]
fn repeated_embedded_start_spawns_one_process() {
    let temp = tempfile::tempdir().expect("temp directory");
    let port = free_port();
    let launches = Arc::new(AtomicUsize::new(0));
    let launches_in_launcher = Arc::clone(&launches);
    let mut manager = ServerManager::with_launcher(config(temp.path(), port), move |config| {
        launches_in_launcher.fetch_add(1, Ordering::SeqCst);
        child_launcher(port)(config)
    });

    assert_eq!(manager.start(embedded()).status, ServerStatus::Ready);
    assert_eq!(manager.start(embedded()).status, ServerStatus::Ready);
    assert_eq!(launches.load(Ordering::SeqCst), 1);
}

#[test]
fn external_start_preserves_origin_without_launching_or_updating_binary() {
    let server = http_test::serve(b"MatriX.test".to_vec());
    let origin = server
        .url()
        .strip_suffix("/payload")
        .expect("server origin")
        .to_string();
    let temp = tempfile::tempdir().expect("temp directory");
    let mut manager = ServerManager::with_launcher(config(temp.path(), free_port()), |_| {
        panic!("external mode must not download or launch a binary")
    });

    let handle = manager.start(ServerStartRequest {
        mode: ServerMode::External,
        origin: Some(origin.clone()),
    });

    assert_eq!(handle.status, ServerStatus::Ready);
    assert_eq!(handle.origin, origin);
    assert_eq!(manager.update().origin, origin);
    assert_eq!(manager.stop().origin, origin);
}

#[test]
fn launch_failure_is_reported_in_status() {
    let temp = tempfile::tempdir().expect("temp directory");
    let mut manager = ServerManager::with_launcher(config(temp.path(), free_port()), |_| {
        Err(ServerError::Launch("missing test binary".to_string()))
    });

    let handle = manager.start(embedded());

    assert_eq!(handle.status, ServerStatus::Error);
    assert_eq!(handle.error.as_deref(), Some("missing test binary"));
}

#[test]
fn embedded_start_does_not_adopt_an_existing_server() {
    let server = http_test::serve(b"MatriX.test".to_vec());
    let origin = server
        .url()
        .strip_suffix("/payload")
        .expect("server origin")
        .to_string();
    let temp = tempfile::tempdir().expect("temp directory");
    let mut occupied = config(temp.path(), free_port());
    occupied.origin = origin;
    let mut manager = ServerManager::with_launcher(occupied, |_| {
        panic!("an existing server must not be replaced")
    });

    let handle = manager.start(embedded());

    assert_eq!(handle.status, ServerStatus::Error);
    assert!(handle
        .error
        .as_deref()
        .is_some_and(|error| error.contains("in use")));
}

#[test]
fn dropping_manager_kills_embedded_process() {
    let temp = tempfile::tempdir().expect("temp directory");
    let port = free_port();
    let origin = format!("http://127.0.0.1:{port}");
    let mut manager = ServerManager::with_launcher(config(temp.path(), port), child_launcher(port));
    assert_eq!(manager.start(embedded()).status, ServerStatus::Ready);
    assert!(health(&origin));

    drop(manager);

    assert!(!health(&origin));
}

#[cfg(windows)]
#[test]
fn server_start_health_stop() {
    let temp = tempfile::tempdir().expect("temp directory");
    let mut config = ServerConfig::from_environment().expect("server config");
    config.data_dir = temp.path().join("torrserver");
    config.startup_timeout = Duration::from_secs(60);
    let origin = config.origin.clone();
    let mut manager = ServerManager::new(config);

    let handle = manager.start(embedded());
    let log = std::fs::read_to_string(temp.path().join("torrserver/server.log"))
        .unwrap_or_else(|error| format!("server.log unavailable: {error}"));
    let log_tail = log
        .lines()
        .rev()
        .take(30)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(
        handle.status,
        ServerStatus::Ready,
        "error: {:?}\n{}",
        handle.error,
        log_tail
    );
    assert!(health(&origin));
    assert_eq!(manager.stop().status, ServerStatus::Stopped);
    assert!(!health(&origin));
}

#[test]
fn external_status_rechecks_health_and_preserves_explicit_stop() {
    let server = http_test::serve(b"MatriX.test".to_vec());
    let origin = server
        .url()
        .strip_suffix("/payload")
        .expect("server origin")
        .to_string();
    let temp = tempfile::tempdir().expect("temp directory");
    let mut manager = ServerManager::with_launcher(config(temp.path(), free_port()), |_| {
        panic!("external status checks must not launch a binary")
    });
    assert_eq!(
        manager
            .start(ServerStartRequest {
                mode: ServerMode::External,
                origin: Some(origin),
            })
            .status,
        ServerStatus::Ready
    );

    assert_eq!(manager.status().status, ServerStatus::Error);
    assert_eq!(manager.stop().status, ServerStatus::Stopped);
    assert_eq!(manager.status().status, ServerStatus::Stopped);
}

#[test]
fn torrserver_arguments_bind_http_and_peer_listeners_to_loopback() {
    let config = ServerConfig::new("data");
    let args = torrserver_args(&config);
    let args = args
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let has_pair = |flag: &str, value: &str| {
        args.windows(2)
            .any(|pair| pair[0] == flag && pair[1] == value)
    };

    assert!(has_pair("--ip", "127.0.0.1"));
    let torrent = args
        .windows(2)
        .find(|pair| pair[0] == "--torrentaddr")
        .expect("torrentaddr");
    let addr = &torrent[1];
    assert!(addr.starts_with("127.0.0.1:"), "{addr}");
    let port: u16 = addr
        .rsplit(':')
        .next()
        .expect("port")
        .parse()
        .expect("port number");
    assert_ne!(port, 0, "port 0 is an excluded-range lottery on Windows");
    let bound = std::net::UdpSocket::bind(("127.0.0.1", port)).expect("reserved peer port binds");
    assert_eq!(bound.local_addr().expect("addr").port(), port);
}

#[cfg(windows)]
#[test]
fn server_peer_download() {
    let temp = tempfile::tempdir().expect("temp directory");
    let port = free_port();
    let mut config = ServerConfig::from_environment().expect("server config");
    config.origin = format!("http://127.0.0.1:{port}");
    config.port = port;
    config.data_dir = temp.path().join("torrserver");
    config.startup_timeout = Duration::from_secs(60);
    let origin = config.origin.clone();
    let mut manager = ServerManager::new(config);
    let handle = manager.start(embedded());
    assert_eq!(
        handle.status,
        ServerStatus::Ready,
        "{}",
        handle.error.as_deref().unwrap_or("")
    );

    let script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/peer_download.py")
        .canonicalize()
        .expect("peer helper path");
    let python = std::env::var("OMP_TEST_PYTHON").unwrap_or_else(|_| "python".to_string());
    let output = std::process::Command::new(python)
        .arg(script)
        .arg("--origin")
        .arg(origin)
        .output()
        .expect("run controlled peer helper");
    manager.stop();
    assert!(
        output.status.success(),
        "peer helper failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn embedded_start_retries_early_process_exit() {
    let temp = tempfile::tempdir().expect("temp directory");
    let port = free_port();
    let attempts = Arc::new(AtomicUsize::new(0));
    let attempts_in_launcher = Arc::clone(&attempts);
    let mut manager = ServerManager::with_launcher(config(temp.path(), port), move |config| {
        let attempt = attempts_in_launcher.fetch_add(1, Ordering::SeqCst);
        child_launcher_with_role(config, if attempt < 2 { "exit" } else { "echo" })
    });

    let handle = manager.start(embedded());

    assert_eq!(
        handle.status,
        ServerStatus::Ready,
        "{}",
        handle.error.as_deref().unwrap_or("")
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 3);
}

#[test]
fn start_is_cancelled_while_waiting_for_health() {
    let temp = tempfile::tempdir().expect("temp directory");
    let port = free_port();
    let mut slow = config(temp.path(), port);
    slow.startup_timeout = Duration::from_secs(30);
    let mut manager = ServerManager::with_launcher(slow, child_launcher_silent);
    let cancellation = manager.cancellation();

    let worker = std::thread::spawn(move || manager.start(embedded()));
    wait_for(|| port_open(port));
    cancellation.cancel();
    let handle = worker.join().expect("server start thread");

    assert_eq!(handle.status, ServerStatus::Error);
    assert!(
        handle
            .error
            .as_deref()
            .is_some_and(|error| error.contains("cancelled")),
        "{}",
        handle.error.as_deref().unwrap_or("")
    );
    wait_for(|| !port_open(port));
}

#[test]
fn health_success_after_cancellation_is_rejected() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind delayed health server");
    let port = listener.local_addr().expect("health server address").port();
    let temp = tempfile::tempdir().expect("temp directory");
    let config = config(temp.path(), port);
    let (request_tx, request_rx) = std::sync::mpsc::channel();
    let (response_tx, response_rx) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("health request");
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request);
        request_tx.send(()).expect("request signal");
        response_rx.recv().expect("response permission");
        let body = b"MatriX.test";
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(body);
    });
    let cancellation = super::ServerCancellation::new();
    let generation = cancellation.generation();
    let cancellation_in_worker = cancellation.clone();
    let worker = std::thread::spawn(move || {
        super::wait_for_health(&config, None, &cancellation_in_worker, generation)
    });
    request_rx.recv().expect("health request received");
    cancellation.cancel();
    response_tx.send(()).expect("allow delayed health response");

    let result = worker.join().expect("health worker");
    assert!(matches!(result, Err(ServerError::Cancelled)));
    server.join().expect("health server");
}

#[test]
fn start_after_shutdown_is_rejected_before_launch() {
    let temp = tempfile::tempdir().expect("temp directory");
    let port = free_port();
    let attempts = Arc::new(AtomicUsize::new(0));
    let attempts_in_launcher = Arc::clone(&attempts);
    let mut manager = ServerManager::with_launcher(config(temp.path(), port), move |config| {
        attempts_in_launcher.fetch_add(1, Ordering::SeqCst);
        child_launcher_with_role(config, "echo")
    });
    let cancellation = manager.cancellation();
    cancellation.shutdown();

    let handle = manager.start(embedded());

    assert_eq!(handle.status, ServerStatus::Error);
    assert_eq!(handle.error.as_deref(), Some("server start cancelled"));
    assert_eq!(attempts.load(Ordering::SeqCst), 0);
}
