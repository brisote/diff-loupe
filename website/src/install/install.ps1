$ErrorActionPreference = "Stop"

function Say($message) {
    Write-Host $message
}

function Fail($message) {
    Write-Error "Diffloupe was not installed: $message"
    exit 1
}

$version = "@WINDOWS_VERSION@"
$url = "@SETUP_URL@"
$checksum = "@SETUP_SHA256@"

if ([string]::IsNullOrEmpty($version) -or [string]::IsNullOrEmpty($url)) {
    Fail "no Windows release is available yet."
}

$arch = if ([System.Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
if ($arch -ne "x64") {
    Fail "Diffloupe for Windows needs a 64-bit x64 machine, and this machine is $arch."
}

$osVersion = [System.Environment]::OSVersion.Version
if ($osVersion.Major -lt 10) {
    Fail "Diffloupe needs Windows 10 or 11, and this machine has an older Windows version."
}

$target = if ($env:DIFFLOUPE_APP_DIR) { $env:DIFFLOUPE_APP_DIR } else {
    $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME "AppData\Local" }
    Join-Path $local "Programs\Diffloupe"
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("diffloupe-" + [System.Guid]::NewGuid().ToString("N"))
$setupName = "Diffloupe-$version-windows-x64-setup.exe"
$setup = Join-Path $work $setupName

try {
    New-Item -ItemType Directory -Path $work -Force | Out-Null

    Say "Downloading Diffloupe $version..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing

    if (Test-Path $setup -Stream Zone.Identifier -ErrorAction SilentlyContinue) {
        Unblock-File -Path $setup -ErrorAction SilentlyContinue
    }

    $actual = (Get-FileHash -Path $setup -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $checksum.ToLowerInvariant()) {
        Fail "the download does not match its SHA-256 checksum. Nothing was changed. Try again later."
    }

    Say "Installing into $target..."
    $process = Start-Process -FilePath $setup -ArgumentList "/S" -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        Fail "the setup program failed with code $($process.ExitCode)."
    }

    $app = Join-Path $target "diffloupe.exe"
    if (Test-Path $app) {
        Start-Process -FilePath $app
    }

    Say "Diffloupe $version is installed."
}
finally {
    if (Test-Path $work) {
        Remove-Item -Path $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
