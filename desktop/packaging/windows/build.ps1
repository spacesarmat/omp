[CmdletBinding()]
param(
    [string]$Configuration = "release",
    [string]$CertificatePath = "",
    [string]$VersionOverride = "",
    [switch]$PrintVersionOnly,
    [switch]$RequireSignature
)

function ConvertTo-MsixVersion([string]$version) {
    if ($version -notmatch '^[0-9]+(\.[0-9]+){1,2}(-beta\.[0-9]+)?$') {
        throw "Invalid desktop version: $version"
    }
    $coreVersion = $version.Split("-")[0]
    $parts = @($coreVersion.Split(".") | ForEach-Object { [int]$_ })
    while ($parts.Count -lt 3) {
        $parts += 0
    }
    if ($parts | Where-Object { $_ -lt 0 -or $_ -gt 65535 }) {
        throw "MSIX version component is out of range: $version"
    }
    $revision = 65535
    if ($version -match '-beta\.([0-9]+)$') {
        $revision = [int]$Matches[1]
        if ($revision -lt 1 -or $revision -gt 65534) {
            throw "MSIX beta revision is out of range: $version"
        }
    }
    return "$($parts[0]).$($parts[1]).$($parts[2]).$revision"
}

$ErrorActionPreference = "Stop"
$desktop = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$version = if ($VersionOverride) {
    $VersionOverride
} else {
    (Get-Content -LiteralPath (Join-Path $desktop "src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json).version
}
if ($PrintVersionOnly) {
    ConvertTo-MsixVersion $version
    exit 0
}
$manifestVersion = ConvertTo-MsixVersion $version
$targetDir = Join-Path $desktop "src-tauri/target/$Configuration"
$executable = Join-Path $targetDir "omp-desktop.exe"
if (-not (Test-Path -LiteralPath $executable)) {
    throw "Desktop executable not found: $executable"
}
$outputDir = [IO.Path]::GetFullPath((Join-Path $desktop "dist-desktop"))
$staging = Join-Path $outputDir "msix-staging"
$package = Join-Path $outputDir "OMP-$version.msix"
$assets = Join-Path $staging "Assets"
Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $assets -Force | Out-Null
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
Copy-Item -LiteralPath $executable -Destination (Join-Path $staging "OMP.exe") -Force

$sign = -not [string]::IsNullOrWhiteSpace($CertificatePath)
if ($RequireSignature -and -not $sign) {
    throw "An MSIX signing certificate is required for publication"
}
$cert = $null
if ($sign) {
    $password = ConvertTo-SecureString $env:MSIX_CERTIFICATE_PASSWORD -AsPlainText -Force
    $cert = Get-PfxCertificate -FilePath $CertificatePath -Password $password
    if ($env:MSIX_CERTIFICATE_THUMBPRINT -and $cert.Thumbprint -ne $env:MSIX_CERTIFICATE_THUMBPRINT) {
        throw "Signing certificate thumbprint does not match MSIX_CERTIFICATE_THUMBPRINT"
    }
}

$manifestTemplate = Join-Path $PSScriptRoot "Package.appxmanifest"
$manifest = (Get-Content -LiteralPath $manifestTemplate -Raw).Replace('Version="0.1.0.0"', "Version=`"$manifestVersion`"")
if ($sign) {
    $publisher = [Security.SecurityElement]::Escape($cert.Subject)
    $manifest = $manifest.Replace('Publisher="CN=OMP"', "Publisher=`"$publisher`"")
}
[IO.File]::WriteAllText((Join-Path $staging "AppxManifest.xml"), $manifest, [Text.UTF8Encoding]::new($false))

Add-Type -AssemblyName System.Drawing
$icon = Join-Path $desktop "src-tauri/icons/icon.png"
function Save-Icon([int]$size, [string]$name) {
    $image = [Drawing.Image]::FromFile($icon)
    try {
        $bitmap = [Drawing.Bitmap]::new($image, $size, $size)
        try {
            $bitmap.Save((Join-Path $assets $name), [Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }
    } finally {
        $image.Dispose()
    }
}
Save-Icon 44 "Square44x44Logo.png"
Save-Icon 150 "Square150x150Logo.png"

function Find-WindowsSdkTool([string]$name) {
    $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (Test-Path -LiteralPath $kits) {
        $tool = Get-ChildItem -LiteralPath $kits -Directory |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "x64/$name" } |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1
        if ($tool) {
            return $tool
        }
    }
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw "Windows SDK tool not found: $name"
}

$makeappx = Find-WindowsSdkTool "makeappx.exe"
& $makeappx pack /o /d $staging /p $package
if ($LASTEXITCODE -ne 0) {
    throw "makeappx failed with exit code $LASTEXITCODE"
}

if ($sign) {
    $signtool = Find-WindowsSdkTool "signtool.exe"
    & $signtool sign /fd SHA256 /f $CertificatePath /p $env:MSIX_CERTIFICATE_PASSWORD $package
    if ($LASTEXITCODE -ne 0) {
        throw "signtool failed with exit code $LASTEXITCODE"
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $package
    if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $cert.Thumbprint) {
        throw "MSIX Authenticode verification failed"
    }
}

(Get-Item -LiteralPath $package).FullName
