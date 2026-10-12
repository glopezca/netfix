# Functions, scopes, return values, recursion
saluda() { echo "Hola, ${1:-mundo} ($#)"; }
saluda; saluda Ana Luis
fact() { if (( $1 <= 1 )); then echo 1; else echo $(( $1 * $(fact $(( $1 - 1 ))) )); fi; }
echo "5! = $(fact 5)"
x=global
cambia() { local x=local; y=fuga; echo "dentro: $x"; }
cambia; echo "fuera: $x $y"
dyn() { echo "ve: $x"; }; outer() { local x=outer; dyn; }; outer
ret() { return $1; }; ret 7; echo "ret=$?"
cuenta() { local -i n=0; for a; do n+=1; done; echo $n; }; cuenta a b c
f2() { echo "${FUNCNAME[0]} llamada desde ${FUNCNAME[1]:-main}"; }; g2() { f2; }; g2
declare -f saluda
type -t saluda; type -t echo; type -t if
unset -f saluda; type saluda 2>&1 | sed 's/^.*: //' 
arrfun() { local -a a=("$@"); echo "${#a[@]} ${a[-1]}"; }; arrfun 1 2 "3 4"
sq() { REPLY=$(( $1 * $1 )); }; sq 9; echo $REPLY
