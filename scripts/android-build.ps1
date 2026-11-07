param(
    [ValidateSet('aarch64', 'x86_64', 'armv7', 'i686')]
    [string]$Target = 'aarch64'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. "$PSScriptRoot\android-env.ps1"
& npx.cmd tauri android build --debug --apk --target $Target 2>&1 |
    Tee-Object -FilePath (Join-Path $env:TEMP "nova-android-$Target-build.log")
exit $LASTEXITCODE
