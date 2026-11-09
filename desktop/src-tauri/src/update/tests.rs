use super::{
    MsixInstaller, PackageInstaller, UpdateError, UpdateInfo, UpdateManager, UpdateResultStatus,
};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

fn info(version: &str, url: String, sha256: String) -> UpdateInfo {
    UpdateInfo {
        version: version.to_string(),
        url,
        sha256,
        notes: vec!["Desktop update".to_string()],
        release_url: None,
    }
}

fn https_info(version: &str) -> UpdateInfo {
    info(
        version,
        "https://github.com/spacesarmat/omp/releases/download/v0.2.0/OMP.msix".to_string(),
        "a".repeat(64),
    )
}

struct FakeInstaller {
    calls: Arc<AtomicUsize>,
}

impl PackageInstaller for FakeInstaller {
    fn download(&self, _info: &UpdateInfo) -> Result<PathBuf, UpdateError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(PathBuf::from("OMP.msix"))
    }

    fn download_apply(&self, _info: &UpdateInfo) -> Result<(), UpdateError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[test]
fn newer_version_is_offered_and_downgrade_is_rejected() {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut manager = UpdateManager::with_installer(
        "0.20.10",
        Box::new(FakeInstaller {
            calls: Arc::clone(&calls),
        }),
    );

    assert!(manager
        .check(&https_info("0.20.11"))
        .expect("newer version")
        .is_some());
    assert!(manager
        .check(&https_info("0.20.10-beta.1"))
        .expect("older beta")
        .is_none());
    assert!(matches!(
        manager.apply(&https_info("0.20.9")),
        Err(UpdateError::Downgrade)
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

fn package_server() -> (crate::http_test::MockServer, UpdateInfo) {
    static NEXT_VERSION: AtomicUsize = AtomicUsize::new(100);
    let payload = b"test msix payload";
    let server = crate::http_test::serve(payload.to_vec());
    let version = format!("0.20.{}", NEXT_VERSION.fetch_add(1, Ordering::SeqCst));
    let info = info(
        &version,
        server.url().to_string(),
        format!("{:x}", Sha256::digest(payload)),
    );
    (server, info)
}

#[test]
fn wrong_hash_stops_before_signature_and_install() {
    let (_server, mut info) = package_server();
    info.sha256 = "0".repeat(64);
    let installer = MsixInstaller::with_hooks(
        "expected",
        |_| panic!("signature must not be read"),
        |_| panic!("package must not be installed"),
    );

    assert!(matches!(
        installer.download_apply(&info),
        Err(UpdateError::Download(_))
    ));
}

#[test]
fn missing_signature_blocks_install() {
    let (_server, info) = package_server();
    let installer = MsixInstaller::with_hooks(
        "expected",
        |_| Err(UpdateError::Signature),
        |_| panic!("package must not be installed"),
    );

    assert!(matches!(
        installer.download_apply(&info),
        Err(UpdateError::Signature)
    ));
}

#[test]
fn wrong_signature_blocks_install() {
    let (_server, info) = package_server();
    let installer = MsixInstaller::with_hooks(
        "expected",
        |_| Ok("different".to_string()),
        |_| panic!("package must not be installed"),
    );

    assert!(matches!(
        installer.download_apply(&info),
        Err(UpdateError::Signature)
    ));
}

#[test]
fn signature_is_verified_before_install_and_settings_survive() {
    let (_server, info) = package_server();
    let temp = tempfile::tempdir().expect("temp settings");
    let settings = temp.path().join("settings.json");
    std::fs::write(&settings, b"{\"language\":\"ru\"}").expect("settings fixture");
    let events = Arc::new(Mutex::new(Vec::new()));
    let signature_events = Arc::clone(&events);
    let install_events = Arc::clone(&events);
    let installer = MsixInstaller::with_hooks(
        "expected",
        move |path: &Path| {
            assert_eq!(
                path.extension().and_then(|value| value.to_str()),
                Some("msix")
            );
            signature_events.lock().expect("events").push("signature");
            Ok("EXPECTED".to_string())
        },
        move |_| {
            install_events.lock().expect("events").push("install");
            Ok(())
        },
    );

    installer.download_apply(&info).expect("valid update");

    assert_eq!(
        events.lock().expect("events").as_slice(),
        ["signature", "install"]
    );
    assert_eq!(
        std::fs::read(settings).expect("settings after update"),
        b"{\"language\":\"ru\"}"
    );
}

#[test]
fn pending_update_error_is_returned_once() {
    let temp = tempfile::tempdir().expect("temp update result");
    let path = temp.path().join("update-result.json");
    std::fs::write(
        &path,
        b"{\"status\":\"error\",\"message\":\"MSIX installation failed\"}",
    )
    .expect("update result fixture");

    let result = super::take_pending_update_result_in(&path).expect("pending update result");

    assert_eq!(result.status, UpdateResultStatus::Error);
    assert_eq!(result.message.as_deref(), Some("MSIX installation failed"));
    assert!(!path.exists());
    assert!(super::take_pending_update_result_in(&path).is_none());
}
