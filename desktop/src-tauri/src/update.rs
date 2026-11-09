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

#[derive(Debug)]
pub enum UpdateError {
    InvalidInfo,
    InsecureUrl,
    Downgrade,
    Download(DownloadError),
    Signature,
    Install,
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInfo => write!(f, "invalid update information"),
            Self::InsecureUrl => write!(f, "update URL must use HTTPS"),
            Self::Downgrade => write!(f, "update downgrade is blocked"),
            Self::Download(_) => write!(f, "update download or hash verification failed"),
            Self::Signature => write!(f, "update signature verification failed"),
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

type SignatureHook = dyn Fn(&Path) -> Result<String, UpdateError> + Send + Sync;
type InstallHook = dyn Fn(&Path) -> Result<(), UpdateError> + Send + Sync;

pub struct MsixInstaller {
    expected_thumbprint: String,
    signature: Box<SignatureHook>,
    install: Box<InstallHook>,
}

impl MsixInstaller {
    pub fn new(expected_thumbprint: impl Into<String>) -> Self {
        Self {
            expected_thumbprint: expected_thumbprint.into(),
            signature: Box::new(authenticode_thumbprint),
            install: Box::new(add_appx_package),
        }
    }

    pub fn from_environment() -> Self {
        Self::new(option_env!("OMP_MSIX_THUMBPRINT").unwrap_or(""))
    }

    #[cfg(test)]
    pub fn with_hooks<F, G>(expected_thumbprint: &str, signature: F, install: G) -> Self
    where
        F: Fn(&Path) -> Result<String, UpdateError> + Send + Sync + 'static,
        G: Fn(&Path) -> Result<(), UpdateError> + Send + Sync + 'static,
    {
        Self {
            expected_thumbprint: expected_thumbprint.to_string(),
            signature: Box::new(signature),
            install: Box::new(install),
        }
    }
}

impl PackageInstaller for MsixInstaller {
    fn download(&self, info: &UpdateInfo) -> Result<PathBuf, UpdateError> {
        validate_info(info)?;
        let asset = BinaryAsset {
            target: TargetPlatform::WindowsX64,
            id: "msix".to_string(),
            version: info.version.clone(),
            url: info.url.clone(),
            sha256: info.sha256.clone(),
            max_bytes: MAX_PACKAGE_BYTES,
        };
        Ok(download_verified(asset)?)
    }

    fn download_apply(&self, info: &UpdateInfo) -> Result<(), UpdateError> {
        let package = self.download(info)?;
        let thumbprint = (self.signature)(&package)?;
        if self.expected_thumbprint.is_empty()
            || !thumbprint
                .trim()
                .eq_ignore_ascii_case(self.expected_thumbprint.trim())
        {
            return Err(UpdateError::Signature);
        }
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
        Self::with_installer(
            env!("CARGO_PKG_VERSION"),
            Box::new(MsixInstaller::from_environment()),
        )
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

#[cfg(windows)]
fn authenticode_thumbprint(path: &Path) -> Result<String, UpdateError> {
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$signature = Get-AuthenticodeSignature -LiteralPath $env:OMP_PACKAGE_PATH; if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) { exit 2 }; $signature.SignerCertificate.Thumbprint",
        ])
        .env("OMP_PACKAGE_PATH", path)
        .output()
        .map_err(|_| UpdateError::Signature)?;
    if !output.status.success() {
        return Err(UpdateError::Signature);
    }
    let thumbprint = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if thumbprint.is_empty() {
        return Err(UpdateError::Signature);
    }
    Ok(thumbprint)
}

#[cfg(not(windows))]
fn authenticode_thumbprint(_path: &Path) -> Result<String, UpdateError> {
    Err(UpdateError::Signature)
}

#[cfg(windows)]
fn add_appx_package(path: &Path) -> Result<(), UpdateError> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            "$ErrorActionPreference = 'Stop'; while (Get-Process -Id $env:OMP_UPDATE_PID -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }; Add-AppxPackage -Path $env:OMP_PACKAGE_PATH",
        ])
        .env("OMP_PACKAGE_PATH", path)
        .env("OMP_UPDATE_PID", std::process::id().to_string())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| UpdateError::Install)?;
    Ok(())
}

#[cfg(not(windows))]
fn add_appx_package(_path: &Path) -> Result<(), UpdateError> {
    Err(UpdateError::Install)
}

#[cfg(test)]
mod tests;
