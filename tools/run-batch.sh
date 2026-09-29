#!/bin/bash
# Runs the browser scenarios one at a time with a pause between them (be gentle with the laptop):
#   tools/run-batch.sh <out-dir> <gpu|sw> <scenario>...
# Prints one line per scenario and orientation; the full output of each is in <out-dir>/<scenario>.txt.
out="$1"; mode="$2"; shift 2
mkdir -p "$out"
flag=""; [ "$mode" = "gpu" ] && flag="--gpu"
for s in "$@"; do
  node tools/check-html.mjs dist/ZombieMiner.html --scenario "$s" $flag > "$out/$s.txt" 2>&1
  echo "$s: exit $? -> $(grep -E '^\[' "$out/$s.txt" | tr '\n' ' ') fails: $(grep -c '^  FAIL' "$out/$s.txt")"
  sleep "${ZM_PAUSE:-15}"
done
echo "batch done; leftover zm-check edge processes: $(powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { \$_.CommandLine -match 'zm-check-' }).Count")"
