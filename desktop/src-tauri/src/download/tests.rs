use super::{download_verified, download_verified_in, installed_verified_in, DownloadError};
use crate::http_test;
use crate::platform::{asset_for, BinaryAsset, TargetPlatform};
use std::fs;
use std::path::{Path, PathBuf};

const PAYLOAD: &[u8] = b"OMP desktop binary fixture";
const PAYLOAD_SHA256: &str = "0ced5ff32e7fd8aa096f55b32af13f07a52e77387a05d0bfaf374aae8bbaf1ac";

fn asset(url: String, sha256: &str, max_bytes: u64) -> BinaryAsset {
    BinaryAsset {
        target: TargetPlatform::WindowsX64,
        id: "torrserver".to_string(),
        version: "1.0.0".to_string(),
        url,
        sha256: sha256.to_string(),
        max_bytes,
    }
}

fn files(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries {
        let path = entry.expect("read test directory").path();
        if path.is_dir() {
            result.extend(files(&path));
        } else {
            result.push(path);
        }
    }
    result
}

#[test]
fn valid_payload_is_persisted_without_part_files() {
    let server = http_test::serve(PAYLOAD.to_vec());
    let temp = tempfile::tempdir().expect("temp directory");

    let path = download_verified_in(
        asset(server.url().to_string(), PAYLOAD_SHA256, 26),
        temp.path(),
    )
    .expect("valid payload must be stored");

    assert_eq!(fs::read(&path).expect("read stored payload"), PAYLOAD);
    assert_eq!(
        path.file_name().and_then(|name| name.to_str()),
        Some("torrserver.exe")
    );
    assert!(path.starts_with(temp.path()));
    assert_eq!(files(temp.path()), vec![path]);
}

#[test]
fn hash_mismatch_removes_downloaded_payload() {
    let server = http_test::serve(PAYLOAD.to_vec());
    let temp = tempfile::tempdir().expect("temp directory");

    let result = download_verified_in(
        asset(server.url().to_string(), &"0".repeat(64), 26),
        temp.path(),
    );

    assert!(matches!(result, Err(DownloadError::HashMismatch)));
    assert!(files(temp.path()).is_empty());
}

#[test]
fn oversized_body_is_removed_before_hash_validation() {
    let server = http_test::serve(b"123456789".to_vec());
    let temp = tempfile::tempdir().expect("temp directory");

    let result = download_verified_in(
        asset(server.url().to_string(), PAYLOAD_SHA256, 8),
        temp.path(),
    );

    assert!(matches!(result, Err(DownloadError::TooLarge)));
    assert!(files(temp.path()).is_empty());
}

#[test]
fn insecure_http_url_is_rejected() {
    let temp = tempfile::tempdir().expect("temp directory");

    let result = download_verified_in(
        asset("http://example.com/payload".to_string(), PAYLOAD_SHA256, 26),
        temp.path(),
    );

    assert!(matches!(result, Err(DownloadError::InsecureUrl)));
    assert!(files(temp.path()).is_empty());
}

#[test]
fn path_traversal_in_id_is_rejected() {
    let mut unsafe_asset = asset(
        "https://example.com/payload".to_string(),
        PAYLOAD_SHA256,
        26,
    );
    unsafe_asset.id = "../escape".to_string();

    let result = download_verified(unsafe_asset);

    assert!(matches!(result, Err(DownloadError::InvalidAsset(_))));
}

#[test]
fn path_traversal_in_version_is_rejected() {
    let temp = tempfile::tempdir().expect("temp directory");
    let mut unsafe_asset = asset(
        "https://example.com/payload".to_string(),
        PAYLOAD_SHA256,
        26,
    );
    unsafe_asset.version = "..\\escape".to_string();

    let result = download_verified_in(unsafe_asset, temp.path());

    assert!(matches!(result, Err(DownloadError::InvalidAsset(_))));
    assert!(files(temp.path()).is_empty());
}

#[test]
fn missing_target_asset_is_an_explicit_error() {
    assert!(matches!(
        asset_for(TargetPlatform::LinuxArm64),
        Err(DownloadError::UnsupportedTarget(TargetPlatform::LinuxArm64))
    ));
}

#[test]
fn windows_asset_matches_the_official_release_pin() {
    let asset = asset_for(TargetPlatform::WindowsX64).expect("Windows asset");

    assert_eq!(asset.target, TargetPlatform::WindowsX64);
    assert_eq!(asset.id, "torrserver");
    assert_eq!(asset.version, "MatriX.150");
    assert_eq!(
        asset.url,
        "https://github.com/YouROK/TorrServer/releases/download/MatriX.150/TorrServer-windows-amd64.exe"
    );
    assert_eq!(
        asset.sha256,
        "3a96b97a24d86a90c0712a6ec47d4ed52edc7eabac1bce6a0d9bbc8fd30de5bb"
    );
    assert_eq!(asset.max_bytes, 63_884_288);
}

#[test]
fn corrupt_cached_binary_is_replaced_by_verified_download() {
    let cached = tempfile::tempdir().expect("temp directory");
    let cached_path = cached
        .path()
        .join("bin")
        .join("windows-x64")
        .join("1.0.0")
        .join("torrserver.exe");
    fs::create_dir_all(cached_path.parent().expect("cache parent"))
        .expect("create cache directory");
    fs::write(&cached_path, b"corrupt cached payload").expect("write corrupt cache");
    let server = http_test::serve(PAYLOAD.to_vec());

    let path = download_verified_in(
        asset(server.url().to_string(), PAYLOAD_SHA256, 26),
        cached.path(),
    )
    .expect("corrupt cache must be replaced by a verified download");

    assert_eq!(path, cached_path);
    assert_eq!(fs::read(&path).expect("read replaced payload"), PAYLOAD);
    assert_eq!(files(cached.path()), vec![path]);
}

#[cfg(windows)]
#[test]
fn concurrent_downloads_accept_the_other_verified_file() {
    use std::os::windows::fs::OpenOptionsExt;

    let temp = tempfile::tempdir().expect("temp directory");
    let root = temp.path();
    let final_path = root
        .join("bin")
        .join("windows-x64")
        .join("1.0.0")
        .join("torrserver.exe");
    let file_lock = std::sync::Arc::new(std::sync::Mutex::new(None::<fs::File>));
    let lock_in_hook = std::sync::Arc::clone(&file_lock);
    let path_in_hook = final_path.clone();
    let (first_url, second_url) = http_test::serve_pair_with_hook(PAYLOAD.to_vec(), move || {
        fs::create_dir_all(path_in_hook.parent().expect("final parent"))
            .expect("create final directory");
        fs::write(&path_in_hook, PAYLOAD).expect("write verified file");
        let file = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path_in_hook)
            .expect("lock verified file");
        *lock_in_hook.lock().expect("file lock") = Some(file);
    });
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));

    let results = std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for url in [first_url, second_url] {
            let barrier = std::sync::Arc::clone(&barrier);
            let asset = asset(url, PAYLOAD_SHA256, 26);
            handles.push(scope.spawn(move || {
                barrier.wait();
                download_verified_in(asset, root)
            }));
        }
        handles
            .into_iter()
            .map(|handle| handle.join().expect("download thread"))
            .collect::<Vec<_>>()
    });

    file_lock.lock().expect("file lock").take();
    assert!(results.iter().all(Result::is_ok), "{results:?}");
    assert_eq!(
        results[0].as_ref().expect("first path"),
        results[1].as_ref().expect("second path")
    );
    assert_eq!(
        fs::read(results[0].as_ref().expect("payload path")).expect("read payload"),
        PAYLOAD
    );
    assert_eq!(files(root).len(), 1);
}

#[test]
fn installed_verified_checks_existing_binary_without_downloading() {
    let temp = tempfile::tempdir().expect("temp directory");
    let asset = asset(
        "https://example.com/payload".to_string(),
        PAYLOAD_SHA256,
        26,
    );
    let final_path = temp
        .path()
        .join("bin")
        .join("windows-x64")
        .join("1.0.0")
        .join("torrserver.exe");

    assert!(!installed_verified_in(asset.clone(), temp.path()).expect("missing binary"));
    fs::create_dir_all(final_path.parent().expect("binary parent"))
        .expect("create binary directory");
    fs::write(&final_path, PAYLOAD).expect("write verified binary");
    assert!(installed_verified_in(asset.clone(), temp.path()).expect("verified binary"));
    fs::write(&final_path, b"corrupt").expect("write corrupt binary");
    assert!(!installed_verified_in(asset, temp.path()).expect("corrupt binary"));
}
