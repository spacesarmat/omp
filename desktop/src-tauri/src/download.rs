use crate::platform::{BinaryAsset, TargetPlatform};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use ureq::Agent;

static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub enum DownloadError {
    UnsupportedTarget(TargetPlatform),
    InvalidAsset(&'static str),
    InsecureUrl,
    HttpStatus(u16),
    TooLarge,
    HashMismatch,
    StorageUnavailable,
    Http(ureq::Error),
    Io(io::Error),
}

impl fmt::Display for DownloadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedTarget(target) => write!(f, "unsupported binary target: {target:?}"),
            Self::InvalidAsset(reason) => write!(f, "invalid binary asset: {reason}"),
            Self::InsecureUrl => write!(f, "binary URL must use HTTPS"),
            Self::HttpStatus(status) => write!(f, "binary download returned HTTP {status}"),
            Self::TooLarge => write!(f, "binary exceeds the allowed size"),
            Self::HashMismatch => write!(f, "binary SHA-256 mismatch"),
            Self::StorageUnavailable => write!(f, "application data directory is unavailable"),
            Self::Http(_) => write!(f, "binary network request failed"),
            Self::Io(error) => write!(f, "binary storage failed: {error}"),
        }
    }
}

impl std::error::Error for DownloadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Http(error) => Some(error),
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<ureq::Error> for DownloadError {
    fn from(error: ureq::Error) -> Self {
        Self::Http(error)
    }
}

impl From<io::Error> for DownloadError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

struct PendingDownload {
    path: PathBuf,
    armed: bool,
}

impl PendingDownload {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingDownload {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub fn download_verified(asset: BinaryAsset) -> Result<PathBuf, DownloadError> {
    let root = dirs::data_local_dir()
        .ok_or(DownloadError::StorageUnavailable)?
        .join("com.spacesarmat.omp.desktop");
    download_verified_in(asset, &root)
}

fn download_verified_in(asset: BinaryAsset, root: &Path) -> Result<PathBuf, DownloadError> {
    validate_asset(&asset)?;
    let final_path = root
        .join("bin")
        .join(asset.target.as_str())
        .join(&asset.version)
        .join(asset.target.executable_name(&asset.id));
    if final_path.exists() {
        if hash_file(&final_path)? == asset.sha256.to_ascii_lowercase() {
            return Ok(final_path);
        }
        fs::remove_file(&final_path)?;
    }

    let https = has_scheme(&asset.url, "https://");
    let agent = Agent::new_with_config(
        Agent::config_builder()
            .http_status_as_error(false)
            .https_only(https)
            .timeout_global(Some(Duration::from_secs(600)))
            .build(),
    );
    let mut response = agent.get(&asset.url).call()?;
    if response.status().as_u16() != 200 {
        return Err(DownloadError::HttpStatus(response.status().as_u16()));
    }

    let parent = final_path
        .parent()
        .ok_or(DownloadError::InvalidAsset("missing destination"))?;
    fs::create_dir_all(parent)?;
    let temp_id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
    let temp_path = final_path.with_extension(format!("part-{}-{temp_id}", std::process::id()));
    let mut pending = PendingDownload::new(temp_path.clone());
    let mut reader = response.body_mut().as_reader();
    let digest = {
        let mut file = File::create(&temp_path)?;
        let mut hasher = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            if count as u64 > asset.max_bytes - total {
                return Err(DownloadError::TooLarge);
            }
            total += count as u64;
            hasher.update(&buffer[..count]);
            file.write_all(&buffer[..count])?;
        }
        file.sync_all()?;
        hex_digest(&hasher.finalize())
    };
    if digest != asset.sha256.to_ascii_lowercase() {
        return Err(DownloadError::HashMismatch);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o755))?;
    }
    fs::rename(&temp_path, &final_path)?;
    pending.disarm();
    Ok(final_path)
}

fn validate_asset(asset: &BinaryAsset) -> Result<(), DownloadError> {
    validate_component(&asset.id)?;
    validate_component(&asset.version)?;
    if asset.max_bytes == 0 {
        return Err(DownloadError::InvalidAsset("empty size limit"));
    }
    if asset.sha256.len() != 64 || !asset.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DownloadError::InvalidAsset("invalid SHA-256"));
    }
    if !has_scheme(&asset.url, "https://") && !is_test_loopback(&asset.url) {
        return Err(DownloadError::InsecureUrl);
    }
    Ok(())
}

fn validate_component(value: &str) -> Result<(), DownloadError> {
    let valid_edges = value
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric);
    let valid_characters = value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if !valid_edges || !valid_characters {
        return Err(DownloadError::InvalidAsset("unsafe path component"));
    }
    Ok(())
}

fn has_scheme(url: &str, scheme: &str) -> bool {
    url.get(..scheme.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme))
}

#[cfg(not(test))]
fn is_test_loopback(_url: &str) -> bool {
    false
}

#[cfg(test)]
fn is_test_loopback(url: &str) -> bool {
    url.starts_with("http://127.0.0.1:")
}

fn hash_file(path: &Path) -> Result<String, DownloadError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex_digest(&hasher.finalize()))
}

fn hex_digest(digest: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests;
