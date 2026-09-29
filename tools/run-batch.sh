#!/bin/bash
# Runs the browser scenarios one at a time with a pause between them (be gentle with the laptop):
#   tools/run-batch.sh <out-dir> <gpu|sw> <scenario>...      (`audio:locked` = the audio scenario with --locked-audio)
# Prints one line per scenario and orientation; the full output of each is in <out-dir>/<scenario>.txt.
out="$1"; mode="$2"; shift 2
mkdir -p "$out"
flag=""; [ "$mode" = "gpu" ] && flag="--gpu"
for spec in "$@"; do
  s="${spec%%:*}"; extra=""
  [ "$spec" != "$s" ] && [ "${spec#*:}" = "locked" ] && extra="--locked-audio"
  name="${spec//:/-}"
  node tools/check-html.mjs dist/ZombieMiner.html --scenario "$s" $flag $extra > "$out/$name.txt" 2>&1
  echo "$name: exit $? -> $(grep -E '^\[' "$out/$name.txt" | tr '\n' ' ') fails: $(grep -c '^  FAIL' "$out/$name.txt")"
  sleep "${ZM_PAUSE:-15}"
done
echo "batch done; leftover zm-check edge processes: $(powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { \$_.CommandLine -match 'zm-check-' }).Count")"
