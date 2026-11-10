#!/usr/bin/env bash
# Build or serve the example sites in examples/sites/ with this checkout's ssqch.
#
#   scripts/examples.sh              build every example (link checks included)
#   scripts/examples.sh blog-tags    serve one at http://localhost:8080 with live reload
#
# Uses target/release/ssqch, building it first if it's missing or older than
# the source (set SSQCH_BIN to use another binary).
set -euo pipefail
cd "$(dirname "$0")/.."

bin=${SSQCH_BIN:-target/release/ssqch}
if [ -z "${SSQCH_BIN:-}" ] && { [ ! -x "$bin" ] || [ -n "$(find crates plugins Cargo.lock -newer "$bin" -type f -print -quit)" ]; }; then
	cargo build --release -p ssqch
fi

if [ $# -gt 0 ]; then
	site=examples/sites/$1
	[ -f "$site/ssqch.config.js" ] || { echo "no example named $1 (examples: $(ls examples/sites | grep -v README | tr '\n' ' '))" >&2; exit 1; }
	exec "$bin" serve --root "$site"
fi

for site in examples/sites/*/; do
	echo "== $(basename "$site")"
	"$bin" build --root "$site" --quiet
	echo "ok: ${site%/}/dist"
done
