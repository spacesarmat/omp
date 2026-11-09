use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TargetPlatform {
    WindowsX64,
    MacOsX64,
    MacOsArm64,
    LinuxX64,
    LinuxArm64,
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
