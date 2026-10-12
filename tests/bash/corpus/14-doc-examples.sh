echo f{1..3}.txt {a,b}x {01..10..3}
echo $(( 2**10 % 7 ))
v=hola; echo ${v@Q} ${v@U} ${v@u} ${v~~}; declare -A a=([x]=1); echo ${a@K}
echo ${v@A}
declare -n ref=v; echo $ref
declare -i n=5; n+=2; echo $n
exec {fd}> x.txt; echo $fd; echo hi >&$fd; exec {fd}>&-; cat x.txt
read -r a b <<< "uno dos"; echo $b
[[ abc =~ ^a(b)c$ ]] && echo ${BASH_REMATCH[1]}
echo $(( 2#1010 + 0x1F + 017 ))
x=abc; echo ${x/b/[&]}
case z in z) echo z ;& y) echo y ;; esac
set -o noclobber; echo a > x.txt; echo $?; echo b >| x.txt; cat x.txt
exec 3<> x.txt; cat <&3
v=hola; echo ${v@A}; declare -i n=7; echo ${n@A}; a=(x y); echo ${a@A}; echo ${a[@]@A}; declare -A b=([k]=1); echo "[${b@A}]" "[${b[@]@A}]"; echo ${v@K} ${a@K} "[${b@K}]" ${a[@]@K}; export e=1; echo ${e@A}; declare -r r=; echo ${r@A}
echo $BASH_COMMAND
trap 'echo "falló: $BASH_COMMAND"' ERR
false x
ls /nada 2>/dev/null
