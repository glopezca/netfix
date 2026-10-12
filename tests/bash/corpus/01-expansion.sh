# Parameter expansion operators
s="Hola Mundo cruel"
p=/usr/local/lib/libx.so.1
echo "${s#* }" "${s##* }" "${s% *}" "${s%% *}"
echo "${p##*/}" "${p%/*}" "${p%%.*}" "${p#*.}"
echo "${s/o/0}" "${s//o/0}" "${s/#H/h}" "${s/%l/L}" "${s//[aeiou]/}"
echo "${s:5}" "${s:5:5}" "${s: -5}" "${s: -5:2}" "${s:0:-6}"
echo "${s^^}" "${s,,}" "${s^}" "${s,}" "${s~~}"
echo "${#s}" "${#p}"
unset u; e=
echo "[${u:-def}] [${e:-def}] [${e-def}] [${u-def}] [${u:+alt}] [${s:+alt}]"
echo "[${u:=asignada}] [$u]"
n=valor; ref=n; echo "${!ref}"
declare -n nr=n; nr=cambiado; echo "$n"
arr=(cero uno dos tres)
echo "${arr[@]:1:2}" "${#arr[@]}" "${!arr[@]}" "${arr[-1]}" "${#arr[2]}"
echo "${arr[@]/o/O}" "${arr[*]^}"
v1=a v2=b v3=c; echo "${!v@}"
x="it's"; echo "${x@Q}" "${x@U}" "${x@u}"
declare -i num=7; echo "${num@a}" "${arr@a}"
t='\t'; echo "[${t@E}]"
echo "${s/Mundo/&&}"
echo "${undefined:-$(echo sub)}" "${s:+"con espacios"}"
