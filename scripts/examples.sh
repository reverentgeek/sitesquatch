#!/usr/bin/env bash
# Build or serve the example sites in examples/sites/ with this checkout's ssqch.
#
#   scripts/examples.sh              build every example (link checks included)
#   scripts/examples.sh blog-tags    serve one at http://localhost:8080 with live reload
#
# Uses the Node build from this checkout (packages/ssqch/bin/ssqch.ts, which Node runs as it is);
# set SSQCH_BIN to use another ssqch.
set -euo pipefail
cd "$(dirname "$0")/.."

bin=${SSQCH_BIN:-packages/ssqch/bin/ssqch.ts}
if [ -z "${SSQCH_BIN:-}" ] && [ ! -d packages/ssqch/node_modules ]; then
	(cd packages/ssqch && npm ci)
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
