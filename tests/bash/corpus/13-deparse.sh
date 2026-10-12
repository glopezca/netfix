f() { if [ -x a ]; then echo a; return $?; elif false; then :; else printf "x\n" >&2; fi; for i in 1 2; do echo $i; done; while true; do break; done; case $x in a) echo a;; b|c) echo b ;; esac; (cd /; ls); { echo g; }; x=1; echo $(( 1+2 )); (( x++ )); [[ -n $x && $x == 1 ]]; a | b; a && b || c; sleep 1 & echo 2>/dev/null; for ((i=0;i<3;i++)); do :; done; }
declare -f f
g() { echo a; echo b; }
declare -f g
