#!/usr/bin/env bash
# Regenerates tests/bash/corpus/*.out with the system bash (reference implementation).
# Scripts named *.manual.sh keep a hand-written .out (features newer than the local bash).
set -u
dir=$(cd "$(dirname "$0")/../tests/bash/corpus" && pwd)
for f in "$dir"/*.sh; do
  case $f in *.manual.sh) continue ;; esac
  tmp=$(mktemp -d)
  cp "$f" "$tmp/script.sh"
  ( cd "$tmp" && env -i HOME=/home/alumno PATH=/usr/bin:/bin LC_ALL=C.UTF-8 TERM=dumb bash script.sh a1 a2 </dev/null >out.txt 2>&1; echo "[status $?]" >> out.txt )
  cp "$tmp/out.txt" "${f%.sh}.out"
  rm -rf "$tmp"
done
