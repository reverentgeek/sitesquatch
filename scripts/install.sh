#!/bin/sh
# Installs the standalone ssqch executable, from a release on GitHub:
#
#   curl --proto '=https' --tlsv1.2 -LsSf https://github.com/reverentgeek/sitesquatch/releases/latest/download/ssqch-installer.sh | sh
#
# Each release has its own copy, which installs that release (download/v0.8.0/ssqch-installer.sh);
# the copy in the repository installs the latest. It downloads the archive for this machine,
# checks it against the release's SHA-256 checksum, and puts `ssqch` in a folder on the PATH:
#
#   SSQCH_INSTALL_DIR        the folder (default: ~/.local/bin, or ~/.cargo/bin where 0.7's
#                            installer put ssqch, so the new one doesn't hide behind the old)
#   SSQCH_UNMANAGED_INSTALL  a folder to install into, leaving shell profiles alone (CI, Netlify)
#   SSQCH_NO_MODIFY_PATH=1   don't add the folder to shell profiles
#   SSQCH_VERSION            another release (0.8.0)
#   SSQCH_DOWNLOAD_URL       where the archives are, instead of the release's page on GitHub
#
# The executable is Node.js with ssqch inside it; it unpacks itself on its first run, into
# ~/Library/Caches/ssqch on macOS or ~/.cache/ssqch on Linux (SSQCH_UNPACK_DIR chooses another
# folder). With Node 22.18 or newer, `npm install --save-dev ssqch` in a site is the other way.
set -eu

REPO=reverentgeek/sitesquatch
# The release workflow writes the release's version here.
RELEASE="@SSQCH_VERSION@"

say() { printf 'ssqch-installer: %s\n' "$*"; }
fail() { printf 'ssqch-installer: error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "this needs $1, and it isn't installed"; }

version="${SSQCH_VERSION:-$RELEASE}"
version="${version#v}"
case "$version" in @*@) version=latest ;; esac

os=$(uname -s)
arch=$(uname -m)
case "$os" in
	Darwin)
		# A shell under Rosetta says x86_64 on Apple silicon; the native executable is faster.
		if [ "$arch" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi
		case "$arch" in
			arm64 | aarch64) target=aarch64-apple-darwin ;;
			x86_64) target=x86_64-apple-darwin ;;
			*) fail "no ssqch executable for macOS on $arch" ;;
		esac ;;
	Linux)
		[ "$arch" = x86_64 ] || [ "$arch" = amd64 ] || fail "no ssqch executable for Linux on $arch yet. With Node.js 22.18 or newer, install it from npm: npm install --save-dev ssqch"
		# Node's own Linux builds, which the executable is, need glibc 2.28 or newer.
		if ldd --version 2>&1 | grep -qi musl || [ -e /etc/alpine-release ]; then
			fail "the ssqch executable needs glibc, and this system has musl (Alpine). Install Node.js (apk add nodejs npm) and ssqch from npm: npm install --save-dev ssqch"
		fi
		target=x86_64-unknown-linux-gnu ;;
	MINGW* | MSYS* | CYGWIN*) fail "on Windows, use the PowerShell installer: powershell -ExecutionPolicy Bypass -c \"irm https://github.com/$REPO/releases/latest/download/ssqch-installer.ps1 | iex\"" ;;
	*) fail "no ssqch executable for $os. With Node.js 22.18 or newer, install it from npm: npm install --save-dev ssqch" ;;
esac

if [ -n "${SSQCH_DOWNLOAD_URL:-}" ]; then
	base="${SSQCH_DOWNLOAD_URL%/}"
elif [ "$version" = latest ]; then
	base="https://github.com/$REPO/releases/latest/download"
else
	base="https://github.com/$REPO/releases/download/v$version"
fi

if [ -n "${SSQCH_UNMANAGED_INSTALL:-}" ]; then
	dir="$SSQCH_UNMANAGED_INSTALL"
	managed=0
elif [ -n "${SSQCH_INSTALL_DIR:-}" ]; then
	dir="$SSQCH_INSTALL_DIR"
	managed=1
elif [ -x "${CARGO_HOME:-$HOME/.cargo}/bin/ssqch" ]; then
	dir="${CARGO_HOME:-$HOME/.cargo}/bin"
	managed=1
else
	dir="${XDG_BIN_HOME:-$HOME/.local/bin}"
	managed=1
fi

if command -v curl >/dev/null 2>&1; then
	download() { curl --proto '=https,file' --tlsv1.2 -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
	download() { wget -q -O "$2" "$1"; }
else
	fail "this needs curl or wget, and neither is installed"
fi
need tar
if command -v sha256sum >/dev/null 2>&1; then
	sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
	sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
	fail "this needs sha256sum or shasum to check the download, and neither is installed"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
archive="ssqch-$target.tar.gz"
say "downloading $base/$archive"
download "$base/$archive" "$work/$archive" || fail "couldn't download $base/$archive"
download "$base/$archive.sha256" "$work/$archive.sha256" || fail "couldn't download $base/$archive.sha256"
expected=$(cut -d ' ' -f 1 < "$work/$archive.sha256")
actual=$(sha256 "$work/$archive")
[ "$expected" = "$actual" ] || fail "$archive doesn't match its checksum (expected $expected, got $actual): the download was damaged, or isn't the release's"

tar -xzf "$work/$archive" -C "$work"
mkdir -p "$dir"
# Beside it, then renamed over it: a running ssqch keeps the file it started from.
cp "$work/ssqch-$target/ssqch" "$dir/.ssqch.new"
chmod +x "$dir/.ssqch.new"
mv -f "$dir/.ssqch.new" "$dir/ssqch"
installed=$("$dir/ssqch" --version 2>/dev/null) || fail "installed $dir/ssqch, and it doesn't run"
say "installed $installed in $dir"

case ":$PATH:" in
	*":$dir:"*) ;;
	*)
		if [ "$managed" = 1 ] && [ "${SSQCH_NO_MODIFY_PATH:-0}" != 1 ]; then
			line="export PATH=\"$dir:\$PATH\""
			for profile in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
				case "$profile" in
					*/.profile) ;;
					*) [ -f "$profile" ] || continue ;;
				esac
				grep -qsF "$line" "$profile" || printf '\n# ssqch\n%s\n' "$line" >> "$profile"
			done
			say "added $dir to the PATH in your shell profile; open a new shell, or run: $line"
		else
			say "$dir isn't on your PATH: add it, or run $dir/ssqch"
		fi ;;
esac
