# printf, echo, read, let, getopts, shift, eval, source
printf '[%5s][%-5s][%.2s][%05d][%+d][%x][%#o][%e][%g][%.3f][%c]\n' ab cd xyz 42 7 255 8 12345.678 0.0001 3.14159 hola
printf '%s-%s\n' a b c
printf '%q\n' "a b" "it's" ''
printf -v out '%03d' 7; echo "$out"
echo -e 'a\tb\x41\0101'; echo -n sin; echo " salto"; echo -E 'no\tesc'
let "z = 3 * 4" "w = z + 1"; echo $z $w
set -- -a -b valor -c resto final
while getopts "ab:c" op; do case $op in a) echo opt-a;; b) echo "opt-b=$OPTARG";; c) echo opt-c;; esac; done
shift $((OPTIND - 1)); echo "resto: $*"
set -- 1 2 3 4; shift 2; echo "$@"
cmd='echo eval funciona'; eval "$cmd"
echo 'v_src=desde_source' > lib.sh; source ./lib.sh; echo "$v_src"
echo "uno dos" | { read -r p1 p2; echo "$p2 $p1"; }
printf '%s\n' a b c | while read -r l; do echo "l=$l"; done
exec 3>salida.txt; echo "al fd 3" >&3; exec 3>&-; read -r l < salida.txt; echo "$l"
x=1; readonly x; x=2 2>/dev/null; echo "x=$x"
declare -i i=10; i+=5; i=i*2; echo $i
declare -l min=MAYUS; declare -u may=minus; echo "$min $may"
