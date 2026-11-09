use crate::download::{download_verified, DownloadError};
use crate::platform::{BinaryAsset, TargetPlatform};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fmt;
use std::path::{Path, PathBuf};

const MAX_PACKAGE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub notes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateResultStatus {
    Success,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub status: UpdateResultStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug)]
pub enum UpdateError {
    InvalidInfo,
    InsecureUrl,
    Downgrade,
    Download(DownloadError),
    Install,
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInfo => write!(f, "invalid update information"),
            Self::InsecureUrl => write!(f, "update URL must use HTTPS"),
            Self::Downgrade => write!(f, "update downgrade is blocked"),
            Self::Download(_) => write!(f, "update download or hash verification failed"),
            Self::Install => write!(f, "update installation failed"),
        }
    }
}

impl std::error::Error for UpdateError {}

impl From<DownloadError> for UpdateError {
    fn from(error: DownloadError) -> Self {
        Self::Download(error)
    }
}

pub trait PackageInstaller: Send {
    fn download(&self, info: &UpdateInfo) -> Result<PathBuf, UpdateError>;
    fn download_apply(&self, info: &UpdateInfo) -> Result<(), UpdateError>;
}

type InstallHook = dyn Fn(&Path) -> Result<(), UpdateError> + Send + Sync;

pub struct NsisInstaller {
    install: Box<InstallHook>,
}

impl NsisInstaller {
    pub fn new() -> Self {
        Self {
            install: Box::new(add_nsis_package),
        }
    }

    #[cfg(test)]
    pub fn with_install<F>(install: F) -> Self
    where
        F: Fn(&Path) -> Result<(), UpdateError> + Send + Sync + 'static,
    {
        Self {
            install: Box::new(install),
        }
    }
}

impl PackageInstaller for NsisInstaller {
    fn download(&self, info: &UpdateInfo) -> Result<PathBuf, UpdateError> {
        validate_info(info)?;
        let asset = BinaryAsset {
            target: TargetPlatform::WindowsX64,
            id: "nsis".to_string(),
            version: info.version.clone(),
            url: info.url.clone(),
            sha256: info.sha256.clone(),
            max_bytes: MAX_PACKAGE_BYTES,
        };
        Ok(download_verified(asset)?)
    }

    fn download_apply(&self, info: &UpdateInfo) -> Result<(), UpdateError> {
        let package = self.download(info)?;
        (self.install)(&package)
    }
}

pub struct UpdateManager {
    current_version: String,
    installer: Box<dyn PackageInstaller>,
    downloaded: Option<UpdateInfo>,
}

impl UpdateManager {
    pub fn with_installer(
        current_version: impl Into<String>,
        installer: Box<dyn PackageInstaller>,
    ) -> Self {
        Self {
            current_version: current_version.into(),
            installer,
            downloaded: None,
        }
    }

    pub fn from_environment() -> Self {
        Self::with_installer(env!("CARGO_PKG_VERSION"), Box::new(NsisInstaller::new()))
    }

    pub fn check(&self, info: &UpdateInfo) -> Result<Option<UpdateInfo>, UpdateError> {
        validate_info(info)?;
        if compare_versions(&info.version, &self.current_version)? == Ordering::Greater {
            Ok(Some(info.clone()))
        } else {
            Ok(None)
        }
    }

    pub fn download(&mut self, info: &UpdateInfo) -> Result<UpdateInfo, UpdateError> {
        let Some(info) = self.check(info)? else {
            return Err(UpdateError::Downgrade);
        };
        self.installer.download(&info)?;
        self.downloaded = Some(info.clone());
        Ok(info)
    }

    pub fn apply(&mut self, info: &UpdateInfo) -> Result<(), UpdateError> {
        if self.check(info)?.is_none() {
            return Err(UpdateError::Downgrade);
        }
        self.downloaded = None;
        self.installer.download_apply(info)
    }
}

fn validate_info(info: &UpdateInfo) -> Result<(), UpdateError> {
    parse_version(&info.version).ok_or(UpdateError::InvalidInfo)?;
    if info.sha256.len() != 64 || !info.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(UpdateError::InvalidInfo);
    }
    if !has_https_scheme(&info.url) && !is_test_loopback(&info.url) {
        return Err(UpdateError::InsecureUrl);
    }
    Ok(())
}

fn has_https_scheme(url: &str) -> bool {
    url.get(..8)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
}

#[cfg(test)]
fn is_test_loopback(url: &str) -> bool {
    url.starts_with("http://127.0.0.1:")
}

#[cfg(not(test))]
fn is_test_loopback(_url: &str) -> bool {
    false
}

struct ParsedVersion {
    core: Vec<u32>,
    beta: Option<u32>,
}

fn parse_version(value: &str) -> Option<ParsedVersion> {
    let (core, beta) = match value.split_once("-beta.") {
        Some((core, beta))
            if !beta.is_empty() && beta.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            (core, Some(beta.parse().ok()?))
        }
        Some(_) => return None,
        None => (value, None),
    };
    let parts = core
        .split('.')
        .map(|part| {
            if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
                return None;
            }
            part.parse().ok()
        })
        .collect::<Option<Vec<_>>>()?;
    if !(2..=4).contains(&parts.len()) {
        return None;
    }
    Some(ParsedVersion { core: parts, beta })
}

fn compare_versions(candidate: &str, current: &str) -> Result<Ordering, UpdateError> {
    let candidate = parse_version(candidate).ok_or(UpdateError::InvalidInfo)?;
    let current = parse_version(current).ok_or(UpdateError::InvalidInfo)?;
    for index in 0..candidate.core.len().max(current.core.len()) {
        let left = candidate.core.get(index).copied().unwrap_or(0);
        let right = current.core.get(index).copied().unwrap_or(0);
        match left.cmp(&right) {
            Ordering::Equal => {}
            ordering => return Ok(ordering),
        }
    }
    Ok(match (candidate.beta, current.beta) {
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => left.cmp(&right),
        (None, None) => Ordering::Equal,
    })
}

fn update_result_path() -> Result<PathBuf, UpdateError> {
    let root = dirs::data_local_dir().ok_or(UpdateError::Install)?;
    Ok(root
        .join("com.spacesarmat.omp.desktop")
        .join("update-result.json"))
}

pub fn take_pending_update_result() -> Option<UpdateResult> {
    update_result_path()
        .ok()
        .and_then(|path| read_pending_update_result(&path))
}

fn read_pending_update_result(path: &Path) -> Option<UpdateResult> {
    let text = std::fs::read_to_string(path).ok()?;
    let result = serde_json::from_str(&text).ok();
    let _ = std::fs::remove_file(path);
    result
}

#[cfg(test)]
fn take_pending_update_result_in(path: &Path) -> Option<UpdateResult> {
    read_pending_update_result(path)
}

#[cfg(windows)]
const NSIS_HELPER_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; $result = @{status='success'}; try { while (Get-Process -Id $env:OMP_UPDATE_PID -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }; $process = Start-Process -FilePath $env:OMP_PACKAGE_PATH -ArgumentList '/S' -Wait -PassThru; if ($process.ExitCode -ne 0) { throw 'NSIS installation failed' } } catch { $result = @{status='error';message='NSIS installation failed'} }; [IO.File]::WriteAllText($env:OMP_UPDATE_RESULT, ($result | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))";

#[cfg(windows)]
fn add_nsis_package(path: &Path) -> Result<(), UpdateError> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let result_path = update_result_path()?;
    if let Some(parent) = result_path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| UpdateError::Install)?;
    }
    match std::fs::remove_file(&result_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(UpdateError::Install),
    }
    std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            NSIS_HELPER_SCRIPT,
        ])
        .env("OMP_PACKAGE_PATH", path)
        .env("OMP_UPDATE_PID", std::process::id().to_string())
        .env("OMP_UPDATE_RESULT", result_path)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| UpdateError::Install)?;
    Ok(())
}

#[cfg(not(windows))]
fn add_nsis_package(_path: &Path) -> Result<(), UpdateError> {
    Err(UpdateError::Install)
}

#[cfg(test)]
mod tests;
