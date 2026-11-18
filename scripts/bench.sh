#!/usr/bin/env bash
# Benchmark ssqch building the ReverentGeek blog: the npm package as it's published (built
# from packages/ssqch with scripts/build.ts) on this machine's Node, and ssqch 0.7's binary
# beside it when SSQCH_07 names one, for comparison (0.7 isn't in the repository any more:
# `npm install --prefix /tmp/ssqch-07 ssqch@0.7.0` installs it, and on Apple silicon
# SSQCH_07=/tmp/ssqch-07/node_modules/@ssqch/darwin-arm64/bin/ssqch).
#
# Usage: scripts/bench.sh [path/to/blog] [warm-runs]
#
# The blog is cloned into a temporary directory (copy-on-write on APFS), so the original and
# its dist/ are never touched. Each build gets one cold run (no images cached) and N warm runs,
# writing to its own output folder. Results go to bench-results/<timestamp>/. Run it with
# nothing else busy on the machine.
#
# Requires: macOS (/usr/bin/time -l, cp -c), Node 22.18 or newer, and pnpm (the blog's CSS and JS).
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
BLOG=${1:-$REPO/../blog}
WARM_RUNS=${2:-3}
OUT="$REPO/bench-results/$(date +%Y%m%d-%H%M%S)"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/ssqch-bench.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

[ -f "$BLOG/ssqch.config.js" ] || { echo "No ssqch.config.js in $BLOG" >&2; exit 1; }
mkdir -p "$OUT"

echo "Building the npm package..."
(cd "$REPO/packages/ssqch" && { [ -d node_modules ] || npm ci --silent; } && node scripts/build.ts >/dev/null)
NODE_SSQCH="$REPO/packages/ssqch/dist/bin/ssqch.js"
# The package's sharp is the one in packages/ssqch/node_modules, found from dist/.
TOOLS=("ssqch-0.8")
[ -n "${SSQCH_07:-}" ] && [ -x "$SSQCH_07" ] && TOOLS+=("ssqch-0.7")

echo "Cloning blog..."
cp -cR "$BLOG" "$WORK/blog" 2>/dev/null || cp -R "$BLOG" "$WORK/blog"
B="$WORK/blog"
rm -rf "$B/dist" "$B/.cache"
# The blog builds its CSS and JavaScript before ssqch, and its beforeBuild hook checks for them.
echo "Building the blog's CSS and JS..."
(cd "$B" && NODE_ENV=production pnpm run --silent build:css >/dev/null && NODE_ENV=production pnpm run --silent build:js >/dev/null)

RESULTS="$OUT/results.csv"
LOG="$OUT/bench.log"
echo "tool,run,wall_s,user_s,sys_s,maxrss_mb" > "$RESULTS"
: > "$LOG"

now() { python3 -c 'import time; print(time.time())'; }

# measure <tool> <run> <command...>
measure() {
	local tool=$1 run=$2; shift 2
	local t="$WORK/time.txt" start end
	echo "  $tool $run"
	start=$(now)
	/usr/bin/time -l "$@" >>"$LOG" 2>"$t"
	end=$(now)
	cat "$t" >> "$LOG"
	awk -v tool="$tool" -v run="$run" -v wall="$(python3 -c "print(f'{$end - $start:.2f}')")" '
		/ real / { for (i = 1; i <= NF; i++) { if ($i == "user") user = $(i - 1); if ($i == "sys") sys = $(i - 1) } }
		/maximum resident set size/ { rss = sprintf("%.0f", $1 / 1048576) }
		END { print tool "," run "," wall "," user "," sys "," rss }' "$t" >> "$RESULTS"
}

export SSQCH_ENV=production
cd "$B"

for tool in "${TOOLS[@]}"; do
	echo "$tool"
	case $tool in
		ssqch-0.8) cmd=(node "$NODE_SSQCH") ;;
		ssqch-0.7) cmd=("$SSQCH_07") ;;
	esac
	# Each tool gets its own image cache: the cold run starts without one.
	rm -rf "$B/.cache"
	mkdir -p "$B/out-$tool/assets" && cp -R "$B/dist/assets/." "$B/out-$tool/assets/"
	measure "$tool" cold "${cmd[@]}" build --root "$B" --output "$B/out-$tool" --quiet
	for i in $(seq "$WARM_RUNS"); do
		measure "$tool" "warm$i" "${cmd[@]}" build --root "$B" --output "$B/out-$tool" --quiet
	done
done

{
	echo
	printf "%-10s %8s %10s %9s %8s %9s\n" tool cold_s cold_cpu_s cold_mb warm_s warm_mb
	for tool in "${TOOLS[@]}"; do
		awk -F, -v tool="$tool" '
			$1 == tool && $2 == "cold" { cold = $3; cpu = $4 + $5; cmb = $6 }
			$1 == tool && $2 ~ /^warm/ { w[++n] = $3; m[n] = $6 }
			END {
				# the median of the warm runs
				for (i = 1; i <= n; i++) for (j = i + 1; j <= n; j++) if (w[j] < w[i]) { t = w[i]; w[i] = w[j]; w[j] = t }
				printf "%-10s %8s %10.0f %9s %8s %9s\n", tool, cold, cpu, cmb, w[int((n + 1) / 2)], m[n]
			}' "$RESULTS"
	done
	echo
	for tool in "${TOOLS[@]}"; do
		d="$B/out-$tool"
		printf "%-10s %5s image files, %s\n" "$tool" "$(find "$d/img" -type f 2>/dev/null | wc -l | tr -d ' ')" "$(du -sh "$d/img" 2>/dev/null | cut -f1)"
	done
} | tee "$OUT/summary.txt"

echo
echo "Results: $OUT"
