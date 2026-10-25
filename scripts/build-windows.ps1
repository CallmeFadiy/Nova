param(
    [switch]$SkipInstallers
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$config = Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$version = $config.version
$release = Join-Path $root "release\Windows"
New-Item -ItemType Directory -Force -Path $release | Out-Null

$running = Get-Process -Name "nova" -ErrorAction SilentlyContinue
if ($running) {
    $paths = ($running | ForEach-Object { $_.Path }) -join ", "
    throw "Nova.exe is running ($paths). Close it before building so the portable exe can be replaced."
}

$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

Write-Host "[Nova] Building Windows exe and installers..."
& npm.cmd run tauri build
if ($LASTEXITCODE -ne 0) {
    throw "tauri build failed with exit code $LASTEXITCODE"
}

$exe = Get-ChildItem -Path "src-tauri\target" -Filter "nova.exe" -Recurse -File |
    Where-Object { $_.FullName -match "\\release\\" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $exe) {
    throw "nova.exe was not produced by the build"
}

Copy-Item $exe.FullName (Join-Path $release "Nova.exe") -Force
Write-Host "[Nova] Nova.exe -> release\Windows\Nova.exe"

$sidecar = Join-Path $root "src-tauri\binaries\yt-dlp-x86_64-pc-windows-msvc.exe"
if (Test-Path $sidecar) {
    Copy-Item $sidecar (Join-Path $release "yt-dlp-x86_64-pc-windows-msvc.exe") -Force
    Write-Host "[Nova] yt-dlp -> release\Windows"
}

if (-not $SkipInstallers) {
    $setup = Get-ChildItem -Path "src-tauri\target" -Filter "*setup.exe" -Recurse -File |
        Where-Object { $_.FullName -match "\\bundle\\" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($setup) {
        Copy-Item $setup.FullName (Join-Path $release "Nova-$version-setup.exe") -Force
        Write-Host "[Nova] NSIS installer -> release\Windows\Nova-$version-setup.exe"
    }
    else {
        Write-Warning "NSIS installer was not found; portable exe is still available."
    }

    $msi = Get-ChildItem -Path "src-tauri\target" -Filter "*.msi" -Recurse -File |
        Where-Object { $_.FullName -match "\\bundle\\" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($msi) {
        Copy-Item $msi.FullName (Join-Path $release "Nova-$version.msi") -Force
        Write-Host "[Nova] MSI -> release\Windows\Nova-$version.msi"
    }
    else {
        Write-Warning "MSI installer was not found; portable exe is still available."
    }
}

# Build a portable archive on every build so the user always gets a runnable exe.
$stage = Join-Path $env:TEMP "nova-portable-stage"
if (Test-Path $stage) {
    Remove-Item $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item (Join-Path $release "Nova.exe") (Join-Path $stage "Nova.exe") -Force
if (Test-Path $sidecar) {
    Copy-Item $sidecar (Join-Path $stage "yt-dlp-x86_64-pc-windows-msvc.exe") -Force
}
$readme = @"
Nova $version - portable build

1. Extract this archive to any folder.
2. Run Nova.exe.
3. Keep yt-dlp-x86_64-pc-windows-msvc.exe next to Nova.exe.
4. App data is stored in %APPDATA%\com.fadiy.nova.
"@
$readme | Set-Content (Join-Path $stage "README.txt") -Encoding UTF8
$readme | Set-Content (Join-Path $release "README.txt") -Encoding UTF8

$zip = Join-Path $release "Nova-$version-portable.zip"
if (Test-Path $zip) {
    Remove-Item $zip -Force
}
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
Write-Host "[Nova] Portable archive -> release\Windows\Nova-$version-portable.zip"

Write-Host ""
Get-ChildItem $release -File |
    Sort-Object Name |
    Select-Object Name, @{Name = "MB"; Expression = { [math]::Round($_.Length / 1MB, 2) } } |
    Format-Table -AutoSize

exit 0
