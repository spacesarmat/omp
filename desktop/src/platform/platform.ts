export enum TargetPlatform {
  WindowsX64 = 'windows-x64',
  MacOsX64 = 'macos-x64',
  MacOsArm64 = 'macos-arm64',
  LinuxX64 = 'linux-x64',
  LinuxArm64 = 'linux-arm64',
}

export function currentTargetPlatform(): TargetPlatform {
  if (typeof navigator === 'undefined') return TargetPlatform.LinuxX64;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('windows')) return TargetPlatform.WindowsX64;
  if (ua.includes('mac os x') || ua.includes('macintosh')) {
    return ua.includes('arm64') || ua.includes('aarch64') ? TargetPlatform.MacOsArm64 : TargetPlatform.MacOsX64;
  }
  return TargetPlatform.LinuxX64;
}

export function desktopRuntimeInstructions(): string {
  return 'Для запуска OMP нужен Microsoft Edge WebView2 Runtime: https://developer.microsoft.com/microsoft-edge/webview2/';
}
