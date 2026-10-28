# bash -n only parses; bash -x traces every command after its expansions.
cat > t.sh <<'FIN'
if (( $# == 0 )); then echo none; exit 1; fi
for r in "$@"; do
  if [[ -d $r ]]; then echo "$r dir"; else echo "$r other"; fi
done
x=$(( 1 + 2 ))
case $x in 3) echo three ;; esac
while (( x > 2 )); do x=$((x-1)); done
n=$(echo hi)
[ "$n" = hi ] && echo "n=$n"
FIN
bash -n t.sh; echo "n: $?"
printf 'if then\n' > bad.sh
bash -n bad.sh; echo "bad: $?"
bash -x t.sh /tmp /nada; echo "x: $?"
bash -x t.sh; echo "x0: $?"
bash -xc 'echo a; set -n; echo b'; echo "setn: $?"
printf 'echo hola\r\nls\r\n' > crlf.sh; bash crlf.sh; echo "crlf: $?"
