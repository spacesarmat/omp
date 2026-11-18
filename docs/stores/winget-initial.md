# First winget-pkgs pull request

Do not open this until Andy says so. CI will not open it either: `WINGET_LISTED` stays unset.

Package identifier: `Spacesarmat.OMP`
Version: `0.30.0`
Manifests: `packaging/winget/manifests/s/Spacesarmat/OMP/0.30.0/`

1. Fork https://github.com/microsoft/winget-pkgs with the account that will own `WINGET_TOKEN`.
2. Copy the four yaml files to the same path in a branch of that fork.
3. Open a pull request to `microsoft/winget-pkgs` `master`.

Suggested title: `New package: Spacesarmat.OMP version 0.30.0`

Suggested body:

```
### New package checklist

- [x] The package identifier is Spacesarmat.OMP
- [x] Installer is the NSIS setup from the GitHub release, silent switch /S, per-user scope
- [x] InstallerUrl is the v0.30.0 asset OMP-0.30.0-setup.exe
- [x] InstallerSha256 matches that asset

OMP is a GPL-3.0 media player for a TorrServer on the home network.
Windows desktop build, x64, Windows 10 and 11.
Release: https://github.com/spacesarmat/omp/releases/tag/v0.30.0
```

After the pull request is merged, set the repository variable `WINGET_LISTED` to `true` and the secret `WINGET_TOKEN`. Later stable releases then open the update PR through winget-releaser.
