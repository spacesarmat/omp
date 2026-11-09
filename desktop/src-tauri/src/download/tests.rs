use super::{download_verified, download_verified_in, DownloadError};
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
        asset_for(TargetPlatform::LinuxX64),
        Err(DownloadError::UnsupportedTarget(TargetPlatform::LinuxX64))
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
