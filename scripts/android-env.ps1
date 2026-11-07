$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\27.2.12479018"
$env:ANDROID_API_LEVEL = "29"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:PATH"

if (Test-Path 'C:\Projects\cargo-home') {
    $env:CARGO_HOME = 'C:\Projects\cargo-home'
}
