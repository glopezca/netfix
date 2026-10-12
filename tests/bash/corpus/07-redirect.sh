# Redirections, here-docs, pipelines, process substitution
echo uno > f.txt; echo dos >> f.txt; cat f.txt 2>/dev/null || { while read -r l; do echo "$l"; done < f.txt; }
{ echo out; echo err >&2; } 2>&1 | while read -r l; do echo "[$l]"; done
{ echo out; echo err >&2; } > o.txt 2> e.txt; read -r a < o.txt; read -r b < e.txt; echo "$a $b"
{ echo todo; echo err >&2; } &> t.txt; while read -r l; do echo "t: $l"; done < t.txt
nombre=Ana
while read -r l; do echo "$l"; done <<EOF2
Hola $nombre
  sangría $((1+1))
EOF2
while read -r l; do echo "$l"; done <<'EOF2'
Literal $nombre
EOF2
while read -r l; do echo "[$l]"; done <<-EOF2
	sin tabulador
	EOF2
read -r w <<< "cadena aquí"; echo "$w"
echo "a b c" | while read -r x y; do echo "$y"; done
set -o pipefail; false | true; echo "pipefail: $?"; set +o pipefail; false | true; echo "sin: $?"
true | false | true; echo "${PIPESTATUS[@]}"
while read -r l; do echo "ps: $l"; done < <(echo desde-proceso)
set -o noclobber; echo x > f.txt 2>/dev/null || echo "noclobber"; echo x >| f.txt; set +o noclobber
echo final > /dev/null; echo visible
