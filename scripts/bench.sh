#!/usr/bin/env bash
# Benchmark Eleventy against ssqch building the ReverentGeek blog.
#
# Usage: scripts/bench.sh [path/to/blog] [warm-runs]
#
# The blog is cloned into a temporary directory (copy-on-write on APFS), so
# the original and its dist/ are never touched. Each tool gets one cold run
# (no images cached) and N warm runs. Results go to bench-results/<timestamp>/.
#
# Requires: macOS (/usr/bin/time -l, cp -c), cargo, and the blog's
# node_modules installed (pnpm install).
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
BLOG=${1:-$REPO/../blog}
WARM_RUNS=${2:-3}
OUT="$REPO/bench-results/$(date +%Y%m%d-%H%M%S)"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/ssqch-bench.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

[ -x "$BLOG/node_modules/.bin/eleventy" ] || { echo "No Eleventy in $BLOG/node_modules (run pnpm install)" >&2; exit 1; }
mkdir -p "$OUT" "$WORK/bin"

echo "Building ssqch binaries..."
(cd "$REPO" && cargo build --release -q -p reverentgeek && cp target/release/reverentgeek "$WORK/bin/ssqch-default")
(cd "$REPO" && cargo build --release -q -p reverentgeek --features avif && cp target/release/reverentgeek "$WORK/bin/ssqch-avif")
(cd "$REPO" && cargo build --release -q -p reverentgeek) # leave the default build in place

echo "Cloning blog..."
cp -cR "$BLOG" "$WORK/blog" 2>/dev/null || cp -R "$BLOG" "$WORK/blog"
B="$WORK/blog"
rm -rf "$B/dist" "$B/.cache"

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

export ELEVENTY_ENV=production NODE_ENV=production
cd "$B"

echo "Eleventy $("$B/node_modules/.bin/eleventy" --version)"
measure 11ty cold "$B/node_modules/.bin/eleventy"
for i in $(seq "$WARM_RUNS"); do measure 11ty "warm$i" "$B/node_modules/.bin/eleventy"; done

for variant in default avif; do
  echo "ssqch ($variant)"
  rm -rf "$B/out-$variant"
  measure "ssqch-$variant" cold "$WORK/bin/ssqch-$variant" build --root "$B" --output "$B/out-$variant"
  for i in $(seq "$WARM_RUNS"); do
    measure "ssqch-$variant" "warm$i" "$WORK/bin/ssqch-$variant" build --root "$B" --output "$B/out-$variant"
  done
done

{
  echo
  printf "%-14s %8s %8s %10s %10s\n" tool cold_s warm_s cold_cpu_s warm_mb
  for tool in 11ty ssqch-default ssqch-avif; do
    awk -F, -v tool="$tool" '
      $1 == tool && $2 == "cold" { cold = $3; cpu = $4 + $5 }
      $1 == tool && $2 ~ /^warm/ { w[++n] = $3; m[n] = $6 }
      END {
        # median of the warm runs
        for (i = 1; i <= n; i++) for (j = i + 1; j <= n; j++) if (w[j] < w[i]) { t = w[i]; w[i] = w[j]; w[j] = t }
        printf "%-14s %8s %8s %10.0f %10s\n", tool, cold, w[int((n + 1) / 2)], cpu, m[n]
      }' "$RESULTS"
  done
  echo
  for d in dist out-default out-avif; do
    printf "%-12s %5s image files, %s\n" "$d" "$(ls "$B/$d/img" 2>/dev/null | wc -l | tr -d ' ')" "$(du -sh "$B/$d/img" 2>/dev/null | cut -f1)"
  done
} | tee "$OUT/summary.txt"

echo
echo "Results: $OUT"
