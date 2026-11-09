use crate::download::DownloadError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryAsset {
    pub target: TargetPlatform,
    pub id: String,
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TargetPlatform {
    WindowsX64,
    MacOsX64,
    MacOsArm64,
    LinuxX64,
    LinuxArm64,
}

impl TargetPlatform {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WindowsX64 => "windows-x64",
            Self::MacOsX64 => "macos-x64",
            Self::MacOsArm64 => "macos-arm64",
            Self::LinuxX64 => "linux-x64",
            Self::LinuxArm64 => "linux-arm64",
        }
    }

    pub fn executable_name(self, id: &str) -> String {
        match self {
            Self::WindowsX64 => format!("{id}.exe"),
            _ => id.to_string(),
        }
    }
}

pub fn asset_for(target: TargetPlatform) -> Result<BinaryAsset, DownloadError> {
    match target {
        TargetPlatform::WindowsX64 => Ok(BinaryAsset {
            target,
            id: "torrserver".to_string(),
            version: "MatriX.150".to_string(),
            url: "https://github.com/YouROK/TorrServer/releases/download/MatriX.150/TorrServer-windows-amd64.exe".to_string(),
            sha256: "3a96b97a24d86a90c0712a6ec47d4ed52edc7eabac1bce6a0d9bbc8fd30de5bb".to_string(),
            max_bytes: 63_884_288,
        }),
        unsupported => Err(DownloadError::UnsupportedTarget(unsupported)),
    }
}

pub fn current() -> Result<TargetPlatform, String> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        Ok(TargetPlatform::WindowsX64)
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        Ok(TargetPlatform::MacOsX64)
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        Ok(TargetPlatform::MacOsArm64)
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        Ok(TargetPlatform::LinuxX64)
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        Ok(TargetPlatform::LinuxArm64)
    }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64")
    )))]
    {
        Err(format!("unsupported target: {}", std::env::consts::OS))
    }
}

#[cfg(test)]
mod tests {
    use super::current;

    #[test]
    fn current_target_is_supported() {
        assert!(current().is_ok());
    }
}
