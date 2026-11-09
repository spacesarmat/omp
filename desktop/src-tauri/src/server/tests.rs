use super::{
    health, ServerConfig, ServerError, ServerManager, ServerMode, ServerStartRequest, ServerStatus,
};
use crate::http_test;
use std::io::{Read, Write};
use std::net::TcpListener;
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

fn child_launcher(_port: u16) -> impl Fn(&ServerConfig) -> Result<Child, ServerError> {
    move |config| {
        let executable = std::env::current_exe().expect("current test executable");
        crate::process::command(&executable)
            .args(["--exact", "server::tests::child_entrypoint", "--nocapture"])
            .env("OMP_SERVER_TEST_CHILD", "1")
            .env("OMP_SERVER_TEST_PORT", config.port.to_string())
            .spawn()
            .map_err(ServerError::Io)
    }
}

#[test]
fn child_entrypoint() {
    if std::env::var("OMP_SERVER_TEST_CHILD").is_err() {
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

    assert_eq!(
        handle.status,
        ServerStatus::Ready,
        "{}",
        handle.error.as_deref().unwrap_or("")
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
