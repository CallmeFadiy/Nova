$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. "$PSScriptRoot\android-env.ps1"
& npx.cmd tauri android build --debug --apk --target aarch64 2>&1 |
    Tee-Object -FilePath (Join-Path $env:TEMP 'nova-android-build.log')
exit $LASTEXITCODE
