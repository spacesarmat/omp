use super::{
    mpv_args, mpv_asset_for, PlayerManager, PlayerOpenRequest, PlayerProcess, PlayerState,
    PlayerStatus,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn request() -> PlayerOpenRequest {
    PlayerOpenRequest {
        url: "http://127.0.0.1:8090/stream/file?token=secret-query".to_string(),
        title: Some("Test video".to_string()),
        headers: Some(std::collections::HashMap::from([(
            "Authorization".to_string(),
            "Bearer secret-header".to_string(),
        )])),
        start_ms: Some(12_500),
    }
}

struct FakeProcess {
    status: PlayerStatus,
    stopped: Arc<AtomicBool>,
    exit: Option<i32>,
}

impl PlayerProcess for FakeProcess {
    fn pause(&mut self, paused: bool) -> Result<(), String> {
        self.status.state = if paused {
            PlayerState::Paused
        } else {
            PlayerState::Playing
        };
        Ok(())
    }

    fn position(&self) -> Result<(u64, u64), String> {
        Ok((self.status.position_ms, self.status.duration_ms))
    }

    fn stop(&mut self) -> Result<(), String> {
        self.stopped.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        Ok(self.exit)
    }
}

struct ScriptedStream {
    input: std::io::Cursor<Vec<u8>>,
    output: Arc<std::sync::Mutex<Vec<u8>>>,
    delay: std::time::Duration,
}

impl std::io::Read for ScriptedStream {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        std::thread::sleep(self.delay);
        self.input.read(buffer)
    }
}

impl std::io::Write for ScriptedStream {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.output
            .lock()
            .expect("output lock")
            .extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn ipc_ignores_events_and_matches_the_request_id() {
    let output = Arc::new(std::sync::Mutex::new(Vec::new()));
    let stream = ScriptedStream {
        input: std::io::Cursor::new(
            b"{\"event\":\"file-loaded\"}\n{\"data\":12.5,\"request_id\":1,\"error\":\"success\"}\n".to_vec(),
        ),
        output: Arc::clone(&output),
        delay: std::time::Duration::ZERO,
    };
    let ipc = super::MpvIpc {
        stream: std::cell::RefCell::new(Box::new(stream)),
        next_request_id: std::cell::Cell::new(1),
        media_error: Arc::new(AtomicBool::new(false)),
    };

    assert_eq!(
        super::IpcCall::number(&ipc, "time-pos").expect("IPC response"),
        12.5
    );
    let request: serde_json::Value =
        serde_json::from_slice(&output.lock().expect("output lock")).expect("IPC request");
    assert_eq!(
        request["command"],
        serde_json::json!(["get_property", "time-pos"])
    );
    assert_eq!(request["request_id"], 1);
}

#[test]
fn ipc_reply_has_a_deadline() {
    let stream = ScriptedStream {
        input: std::io::Cursor::new(Vec::new()),
        output: Arc::new(std::sync::Mutex::new(Vec::new())),
        delay: std::time::Duration::from_millis(250),
    };
    let ipc = super::MpvIpc {
        stream: std::cell::RefCell::new(Box::new(stream)),
        next_request_id: std::cell::Cell::new(1),
        media_error: Arc::new(AtomicBool::new(false)),
    };
    let worker = ipc.spawn(std::time::Duration::from_millis(20));

    let started = std::time::Instant::now();
    let error =
        super::IpcCall::number(&worker, "time-pos").expect_err("unresponsive IPC must fail");
    assert_eq!(error, "mpv IPC reply timeout");
    assert!(started.elapsed() < std::time::Duration::from_millis(200));
    drop(worker);
    std::thread::sleep(std::time::Duration::from_millis(300));
}

struct FailingLoadProcess {
    stopped: Arc<AtomicBool>,
}

impl PlayerProcess for FailingLoadProcess {
    fn pause(&mut self, _paused: bool) -> Result<(), String> {
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

    fn wait_until_loaded(
        &mut self,
        _cancellation: &super::PlayerCancellation,
        _generation: u64,
    ) -> Result<(), String> {
        Err("media load failed".to_string())
    }
}

#[test]
fn open_stops_the_process_when_media_cannot_load() {
    let stopped = Arc::new(AtomicBool::new(false));
    let stopped_in_launcher = Arc::clone(&stopped);
    let mut manager = PlayerManager::with_launcher(move |_| {
        Ok(Box::new(FailingLoadProcess {
            stopped: Arc::clone(&stopped_in_launcher),
        }))
    });

    assert_eq!(manager.open(request()).state, PlayerState::Error);
    assert!(stopped.load(Ordering::SeqCst));
}

struct SlowLoadProcess {
    stopped: Arc<AtomicBool>,
}

impl PlayerProcess for SlowLoadProcess {
    fn pause(&mut self, _paused: bool) -> Result<(), String> {
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

    fn wait_until_loaded(
        &mut self,
        cancellation: &super::PlayerCancellation,
        generation: u64,
    ) -> Result<(), String> {
        while !cancellation.is_cancelled(generation) {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        Err("cancelled".to_string())
    }
}

#[test]
fn slow_load_can_be_cancelled_without_an_arbitrary_deadline() {
    let stopped = Arc::new(AtomicBool::new(false));
    let stopped_in_launcher = Arc::clone(&stopped);
    let mut manager = PlayerManager::with_launcher(move |_| {
        Ok(Box::new(SlowLoadProcess {
            stopped: Arc::clone(&stopped_in_launcher),
        }))
    });
    let cancellation = manager.cancellation();
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(20));
        cancellation.cancel();
    });

    let started = std::time::Instant::now();
    assert_eq!(manager.open(request()).state, PlayerState::Idle);
    assert!(started.elapsed() < std::time::Duration::from_millis(200));
    assert!(stopped.load(Ordering::SeqCst));
    canceller.join().expect("cancellation thread");
}

#[test]
fn ipc_records_end_file_errors() {
    let media_error = Arc::new(AtomicBool::new(false));
    let stream = ScriptedStream {
        input: std::io::Cursor::new(
            b"{\"event\":\"end-file\",\"reason\":\"error\"}\n{\"data\":12.5,\"request_id\":1,\"error\":\"success\"}\n".to_vec(),
        ),
        output: Arc::new(std::sync::Mutex::new(Vec::new())),
        delay: std::time::Duration::ZERO,
    };
    let ipc = super::MpvIpc {
        stream: std::cell::RefCell::new(Box::new(stream)),
        next_request_id: std::cell::Cell::new(1),
        media_error: Arc::clone(&media_error),
    };

    assert_eq!(
        super::IpcCall::number(&ipc, "time-pos").expect("IPC response"),
        12.5
    );
    assert!(media_error.load(Ordering::SeqCst));
}

struct ExternalPauseProcess {
    paused: Arc<AtomicBool>,
}

impl PlayerProcess for ExternalPauseProcess {
    fn pause(&mut self, paused: bool) -> Result<(), String> {
        self.paused.store(paused, Ordering::SeqCst);
        Ok(())
    }

    fn pause_state(&self) -> Result<Option<bool>, String> {
        Ok(Some(self.paused.load(Ordering::SeqCst)))
    }

    fn position(&self) -> Result<(u64, u64), String> {
        Ok((1_000, 2_000))
    }

    fn stop(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        Ok(None)
    }
}

#[test]
fn status_and_toggle_reconcile_the_actual_pause_state() {
    let paused = Arc::new(AtomicBool::new(true));
    let paused_in_launcher = Arc::clone(&paused);
    let mut manager = PlayerManager::with_launcher(move |_| {
        Ok(Box::new(ExternalPauseProcess {
            paused: Arc::clone(&paused_in_launcher),
        }))
    });
    manager.open(request());

    assert_eq!(manager.status().state, PlayerState::Paused);
    assert_eq!(manager.pause().state, PlayerState::Playing);
    assert!(!paused.load(Ordering::SeqCst));
}

fn launcher() -> impl Fn(&PlayerOpenRequest) -> Result<Box<dyn PlayerProcess>, String> {
    |_| {
        Ok(Box::new(FakeProcess {
            status: PlayerStatus {
                state: PlayerState::Playing,
                position_ms: 1_000,
                duration_ms: 2_000,
                error: None,
            },
            stopped: Arc::new(AtomicBool::new(false)),
            exit: None,
        }))
    }
}

#[test]
fn open_pause_stop_and_status_work() {
    let mut manager = PlayerManager::with_launcher(launcher());

    assert_eq!(manager.open(request()).state, PlayerState::Playing);
    assert_eq!(manager.pause().state, PlayerState::Paused);
    assert_eq!(manager.pause().state, PlayerState::Playing);
    let status = manager.status();
    assert_eq!(status.position_ms, 1_000);
    assert_eq!(status.duration_ms, 2_000);
    assert_eq!(manager.stop().state, PlayerState::Idle);
}

#[test]
fn repeated_open_stops_the_previous_process() {
    let stopped = Arc::new(AtomicBool::new(false));
    let stopped_in_launcher = Arc::clone(&stopped);
    let first = Arc::new(AtomicBool::new(true));
    let first_in_launcher = Arc::clone(&first);
    let mut manager = PlayerManager::with_launcher(move |_| {
        if first_in_launcher.swap(false, Ordering::SeqCst) {
            Ok(Box::new(FakeProcess {
                status: PlayerStatus {
                    state: PlayerState::Playing,
                    position_ms: 0,
                    duration_ms: 0,
                    error: None,
                },
                stopped: Arc::clone(&stopped_in_launcher),
                exit: None,
            }))
        } else {
            launcher()(&request())
        }
    });

    manager.open(request());
    manager.open(request());

    assert!(stopped.load(Ordering::SeqCst));
}

#[test]
fn crashed_process_is_an_error() {
    let mut manager = PlayerManager::with_launcher(|_| {
        Ok(Box::new(FakeProcess {
            status: PlayerStatus {
                state: PlayerState::Playing,
                position_ms: 0,
                duration_ms: 0,
                error: None,
            },
            stopped: Arc::new(AtomicBool::new(false)),
            exit: Some(1),
        }))
    });
    manager.open(request());

    assert_eq!(manager.status().state, PlayerState::Error);
}

#[test]
fn drop_stops_the_process() {
    let stopped = Arc::new(AtomicBool::new(false));
    let stopped_in_launcher = Arc::clone(&stopped);
    let mut manager = PlayerManager::with_launcher(move |_| {
        Ok(Box::new(FakeProcess {
            status: PlayerStatus {
                state: PlayerState::Playing,
                position_ms: 0,
                duration_ms: 0,
                error: None,
            },
            stopped: Arc::clone(&stopped_in_launcher),
            exit: None,
        }))
    });
    manager.open(request());

    drop(manager);

    assert!(stopped.load(Ordering::SeqCst));
}

#[test]
fn launch_errors_do_not_leak_url_or_headers() {
    let mut manager = PlayerManager::with_launcher(|request| {
        Err(format!(
            "launch failed: {} {:?}",
            request.url, request.headers
        ))
    });

    let status = manager.open(request());

    assert_eq!(status.state, PlayerState::Error);
    let error = status.error.unwrap_or_default();
    assert!(!error.contains("secret-query"), "{error}");
    assert!(!error.contains("secret-header"), "{error}");
}

#[test]
fn mpv_arguments_defer_the_media_url_to_ipc() {
    let args = mpv_args(&request(), "ipc-test");
    let args = args
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert!(args.iter().any(|arg| arg == "--input-ipc-server=ipc-test"));
    assert!(args.iter().any(|arg| arg == "--start=12.5"));
    assert!(args.iter().any(|arg| arg == "--title=Test video"));
    assert!(args
        .iter()
        .any(|arg| arg == "--http-header-fields=Authorization: Bearer secret-header"));
    assert!(!args.iter().any(|arg| arg.contains("secret-query")));
}

#[test]
fn mpv_asset_is_pinned_and_has_a_7z_package_name() {
    let asset = mpv_asset_for(super::TargetPlatform::WindowsX64).expect("mpv asset");

    assert_eq!(asset.version, "2026-11-08-git-8bc468896e");
    assert_eq!(asset.url, "https://github.com/zhongfly/mpv-winbuild/releases/download/2026-11-08-8bc468896e/mpv-x86_64-v3-20261108-git-8bc468896e.7z");
    assert_eq!(
        asset.sha256,
        "7f42790ece058d91ebf036db97347da84fe685e87c5dd34af6fee6edb57c3e85"
    );
    assert_eq!(asset.max_bytes, 35_029_818);
    assert_eq!(asset.file_name(), "mpv.7z");
}

#[cfg(windows)]
#[test]
fn windows_ipc_uses_a_short_pipe_name() {
    let config = super::PlayerConfig::new("unused");
    let path = super::ipc_path(&config);

    assert!(path.starts_with("omp-mpv-"));
    assert!(!path.contains(['/', '\\']));
}

#[cfg(not(windows))]
#[test]
fn unix_ipc_uses_a_socket_in_the_data_directory() {
    let config = super::PlayerConfig::new("player-data");

    assert_eq!(
        super::ipc_path(&config),
        std::path::Path::new("player-data")
            .join("mpv-ipc.sock")
            .to_string_lossy()
    );
}

#[cfg(windows)]
#[test]
#[ignore = "requires downloaded mpv and local sample media"]
fn player_smoke_codecs() {
    let root =
        std::env::var("OMP_MPV_SMOKE_DIR").unwrap_or_else(|_| "../../.tmp-mpv-smoke".to_string());
    let files = ["h265.mkv", "av1.mkv", "vc1.avi", "h264-ass.mkv"];
    let config = super::PlayerConfig::from_environment().expect("player config");
    let mut manager = PlayerManager::new(config);

    for file in files {
        let url = std::path::Path::new(&root)
            .join(file)
            .to_string_lossy()
            .into_owned();
        let status = manager.open(PlayerOpenRequest {
            url,
            title: Some(file.to_string()),
            headers: None,
            start_ms: Some(0),
        });
        assert_eq!(
            status.state,
            PlayerState::Playing,
            "{file}: {}",
            status.error.unwrap_or_default()
        );
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert_eq!(manager.pause().state, PlayerState::Paused, "{file}");
        assert_eq!(manager.pause().state, PlayerState::Playing, "{file}");
        assert_eq!(manager.stop().state, PlayerState::Idle, "{file}");
    }

    let status = manager.open(PlayerOpenRequest {
        url: std::path::Path::new(&root)
            .join("missing.mkv")
            .to_string_lossy()
            .into_owned(),
        title: Some("missing.mkv".to_string()),
        headers: None,
        start_ms: Some(0),
    });
    assert_eq!(status.state, PlayerState::Error);
}
