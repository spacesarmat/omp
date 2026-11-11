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

impl BinaryAsset {
    pub fn file_name(&self) -> String {
        if self.id == "mpv" {
            match self.target {
                TargetPlatform::WindowsX64 => "mpv.7z".to_string(),
                TargetPlatform::LinuxX64 | TargetPlatform::LinuxArm64 => "mpv.AppImage".to_string(),
                TargetPlatform::MacOsX64 | TargetPlatform::MacOsArm64 => "mpv.zip".to_string(),
            }
        } else if self.id == "nsis" {
            "OMP-setup.exe".to_string()
        } else if self.id == "dmg" {
            "OMP-update.dmg".to_string()
        } else if self.id == "appimage" {
            "OMP-update.AppImage".to_string()
        } else {
            self.target.executable_name(&self.id)
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
        TargetPlatform::MacOsX64 => Ok(BinaryAsset {
            target,
            id: "torrserver".to_string(),
            version: "MatriX.150".to_string(),
            url: "https://github.com/YouROK/TorrServer/releases/download/MatriX.150/TorrServer-darwin-amd64".to_string(),
            sha256: "b02f732b3b649ab213e95198604e5057aa4d08ca939e0fb4f4d391a00d24beb3".to_string(),
            max_bytes: 70_000_000,
        }),
        TargetPlatform::MacOsArm64 => Ok(BinaryAsset {
            target,
            id: "torrserver".to_string(),
            version: "MatriX.150".to_string(),
            url: "https://github.com/YouROK/TorrServer/releases/download/MatriX.150/TorrServer-darwin-arm64".to_string(),
            sha256: "8baa838c28da9ca67ea8a733b5b874061fd90181274f09664615729cfb1aee86".to_string(),
            max_bytes: 70_000_000,
        }),
        TargetPlatform::LinuxX64 => Ok(BinaryAsset {
            target,
            id: "torrserver".to_string(),
            version: "MatriX.150".to_string(),
            url: "https://github.com/YouROK/TorrServer/releases/download/MatriX.150/TorrServer-linux-amd64".to_string(),
            sha256: "2326559e5047fe0cbea8fd36168d3c9da1243466640f8ee55051640b154788ae".to_string(),
            max_bytes: 70_000_000,
        }),
        unsupported => Err(DownloadError::UnsupportedTarget(unsupported)),
    }
}

pub fn mpv_asset_for(target: TargetPlatform) -> Result<BinaryAsset, DownloadError> {
    match target {
        TargetPlatform::WindowsX64 => Ok(BinaryAsset {
            target,
            id: "mpv".to_string(),
            version: "2026-11-08-git-8bc468896e".to_string(),
            url: "https://github.com/zhongfly/mpv-winbuild/releases/download/2026-11-08-8bc468896e/mpv-x86_64-v3-20261108-git-8bc468896e.7z".to_string(),
            sha256: "7f42790ece058d91ebf036db97347da84fe685e87c5dd34af6fee6edb57c3e85".to_string(),
            max_bytes: 35_029_818,
        }),
        TargetPlatform::MacOsArm64 => Ok(BinaryAsset {
            target,
            id: "mpv".to_string(),
            version: "0.42.0".to_string(),
            url: "https://github.com/mpv-player/mpv/releases/download/v0.42.0/mpv-v0.42.0-macos-15-arm.zip".to_string(),
            sha256: "be1b8d2445e6880860869c080b8710dee189721f1fa4689840db6a2c10d7be69".to_string(),
            max_bytes: 56_000_000,
        }),
        TargetPlatform::MacOsX64 => Ok(BinaryAsset {
            target,
            id: "mpv".to_string(),
            version: "0.42.0".to_string(),
            url: "https://github.com/mpv-player/mpv/releases/download/v0.42.0/mpv-v0.42.0-macos-15-intel.zip".to_string(),
            sha256: "2d2f34350ff844b6014c35f21ca142937275e19c0c673150a8564fcd2f3bfa14".to_string(),
            max_bytes: 60_000_000,
        }),
        TargetPlatform::LinuxX64 => Ok(BinaryAsset {
            target,
            id: "mpv".to_string(),
            version: "0.41.0".to_string(),
            url: "https://github.com/pkgforge-dev/mpv-AppImage/releases/download/v0.41.0%402026-05-01_1777638833/mpv-v0.41.0-anylinux-x86_64.AppImage".to_string(),
            sha256: "c3fd80ee9b7c385d115ec2f8d80e7a364b94c14140c3dd4c1bc5f6b088bd8d7f".to_string(),
            max_bytes: 56_000_000,
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
    use super::{asset_for, current, mpv_asset_for, TargetPlatform};

    #[test]
    fn current_target_is_supported() {
        assert!(current().is_ok());
    }

    #[test]
    fn mac_and_linux_have_pinned_server_and_player() {
        for target in [
            TargetPlatform::MacOsX64,
            TargetPlatform::MacOsArm64,
            TargetPlatform::LinuxX64,
        ] {
            let server = asset_for(target).expect("torrserver");
            let player = mpv_asset_for(target).expect("mpv");
            assert!(server.url.starts_with("https://"));
            assert_eq!(server.sha256.len(), 64);
            assert!(player.url.starts_with("https://"));
            assert_eq!(player.sha256.len(), 64);
            assert!(player.max_bytes >= 48_000_000);
        }
        assert!(asset_for(TargetPlatform::LinuxArm64).is_err());
    }
}
