# Control flow
for i in 1 2 3 4 5 6; do
  if (( i % 2 == 0 )); then continue; fi
  [[ $i -eq 5 ]] && break
  echo "impar $i"
done
for ((i=0, j=10; i<3; i++, j--)); do echo "$i $j"; done
n=3; while [ $n -gt 0 ]; do echo "n=$n"; n=$((n-1)); done
until [[ $n == 3 ]]; do ((n++)); done; echo "until $n"
for x in a b; do for y in 1 2; do [[ $y == 2 ]] && continue 2; echo "$x$y"; done; done
for f in uno.txt dos.TXT tres.c cuatro; do
  case $f in
    *.txt|*.TXT) echo "$f: texto" ;;
    *.c) echo "$f: c" ;&
    tres*) echo "  (continúa)" ;;
    *) echo "$f: otro" ;;
  esac
done
case abc in a*) echo uno;;& *c) echo dos;; *) echo tres;; esac
if false; then echo no; elif true; then echo elif; else echo else; fi
{ echo grupo1; echo grupo2; } | while read -r l; do echo "> $l"; done
(cd / && echo "sub: $PWD"); [[ $PWD != / ]] && echo "fuera: sin cambios"
true && echo y1 || echo n1; false && echo y2 || echo n2
! false && echo negado
x=0; (( x++ )) || echo "post-incremento devuelve 1"; echo $x
[ -z "" ] && [ -n a ] && [ a = a ] && [ 1 -lt 2 ] && echo test-ok
[[ abc =~ ^a(b)(c)$ ]] && echo "${BASH_REMATCH[0]} ${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
[[ ! -e /no/existe ]] && [[ -d / && -f /etc/hostname ]] && echo ficheros-ok
[[ 2 < 10 ]] || echo "cadena: 2 > 10"; (( 2 < 10 )) && echo "número: 2 < 10"
