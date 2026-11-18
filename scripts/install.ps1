# Installs the standalone ssqch executable on Windows, from a release on GitHub:
#
#   powershell -ExecutionPolicy Bypass -c "irm https://github.com/reverentgeek/sitesquatch/releases/latest/download/ssqch-installer.ps1 | iex"
#
# Each release has its own copy, which installs that release (download/v0.8.0/ssqch-installer.ps1);
# the copy in the repository installs the latest. It downloads the archive, checks it against the
# release's SHA-256 checksum, and puts ssqch.exe in a folder on the user's PATH:
#
#   $env:SSQCH_INSTALL_DIR        the folder (default: %LOCALAPPDATA%\ssqch\bin, or
#                                 %USERPROFILE%\.cargo\bin where 0.7's installer put ssqch)
#   $env:SSQCH_UNMANAGED_INSTALL  a folder to install into, leaving the PATH alone (CI)
#   $env:SSQCH_NO_MODIFY_PATH=1   don't add the folder to the user's PATH
#   $env:SSQCH_VERSION            another release (0.8.0)
#   $env:SSQCH_DOWNLOAD_URL       where the archives are, instead of the release's page on GitHub
$ErrorActionPreference = "Stop"

$Repo = "reverentgeek/sitesquatch"
# The release workflow writes the release's version here.
$Release = "@SSQCH_VERSION@"

function Fail($message) {
	Write-Error "ssqch-installer: error: $message"
	exit 1
}

$version = if ($env:SSQCH_VERSION) { $env:SSQCH_VERSION } else { $Release }
$version = $version -replace "^v", ""
if ($version -like "@*@") { $version = "latest" }

$arch = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
if ($arch -ne "AMD64") { Fail "no ssqch executable for Windows on $arch yet. With Node.js 22.18 or newer, install it from npm: npm install --save-dev ssqch" }
$target = "x86_64-pc-windows-msvc"

$base = if ($env:SSQCH_DOWNLOAD_URL) { $env:SSQCH_DOWNLOAD_URL.TrimEnd("/") }
	elseif ($version -eq "latest") { "https://github.com/$Repo/releases/latest/download" }
	else { "https://github.com/$Repo/releases/download/v$version" }

$cargo = Join-Path $(if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $HOME ".cargo" }) "bin"
$managed = $true
if ($env:SSQCH_UNMANAGED_INSTALL) { $dir = $env:SSQCH_UNMANAGED_INSTALL; $managed = $false }
elseif ($env:SSQCH_INSTALL_DIR) { $dir = $env:SSQCH_INSTALL_DIR }
elseif (Test-Path (Join-Path $cargo "ssqch.exe")) { $dir = $cargo }
else { $dir = Join-Path $env:LOCALAPPDATA "ssqch\bin" }

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("ssqch-installer-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
try {
	$archive = "ssqch-$target.zip"
	Write-Host "ssqch-installer: downloading $base/$archive"
	$ProgressPreference = "SilentlyContinue"
	try {
		Invoke-WebRequest -UseBasicParsing -Uri "$base/$archive" -OutFile (Join-Path $work $archive)
		Invoke-WebRequest -UseBasicParsing -Uri "$base/$archive.sha256" -OutFile (Join-Path $work "$archive.sha256")
	} catch { Fail "couldn't download $base/$archive ($($_.Exception.Message))" }
	$expected = ((Get-Content (Join-Path $work "$archive.sha256") -Raw).Trim() -split "\s+")[0].ToLower()
	$actual = (Get-FileHash -Algorithm SHA256 (Join-Path $work $archive)).Hash.ToLower()
	if ($expected -ne $actual) { Fail "$archive doesn't match its checksum (expected $expected, got $actual): the download was damaged, or isn't the release's" }

	Expand-Archive -Path (Join-Path $work $archive) -DestinationPath (Join-Path $work "out")
	New-Item -ItemType Directory -Force -Path $dir | Out-Null
	$exe = Join-Path $dir "ssqch.exe"
	# A running ssqch.exe can't be replaced, but it can be renamed out of the way.
	if (Test-Path $exe) {
		$old = "$exe.old"
		Remove-Item -Force $old -ErrorAction SilentlyContinue
		Rename-Item -Path $exe -NewName "ssqch.exe.old"
	}
	Copy-Item (Join-Path $work "out\ssqch.exe") $exe
	Remove-Item -Force "$exe.old" -ErrorAction SilentlyContinue
	$installed = & $exe --version
	if ($LASTEXITCODE -ne 0) { Fail "installed $exe, and it doesn't run" }
	Write-Host "ssqch-installer: installed $installed in $dir"
} finally {
	Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = @($userPath -split ";" | Where-Object { $_ })
if ($parts -notcontains $dir -and ($env:Path -split ";") -notcontains $dir) {
	if ($managed -and $env:SSQCH_NO_MODIFY_PATH -ne "1") {
		[Environment]::SetEnvironmentVariable("Path", (@($dir) + $parts) -join ";", "User")
		Write-Host "ssqch-installer: added $dir to your PATH; open a new terminal to use ssqch"
	} else {
		Write-Host "ssqch-installer: $dir isn't on your PATH: add it, or run $dir\ssqch.exe"
	}
}
