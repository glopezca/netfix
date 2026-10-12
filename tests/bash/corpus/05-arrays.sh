# Indexed and associative arrays
a=(x y z); a+=(w); a[10]=diez; echo "${a[@]}" "${#a[@]}" "${!a[@]}"
unset 'a[1]'; echo "${a[@]}" "${!a[@]}"
b=("${a[@]}"); echo "${#b[@]} ${b[1]}"
declare -A edad=([ana]=30 [luis]=25)
edad[eva]=41; edad[ana]+=1
for k in ana eva luis; do echo "$k=${edad[$k]}"; done
echo "${#edad[@]}"
[[ -v edad[luis] ]] && echo "luis existe"; [[ -v edad[nadie] ]] || echo "nadie no"
mapfile -t lineas <<< $'l1\nl2\nl3'; echo "${#lineas[@]} ${lineas[2]}"
read -ra palabras <<< "una dos tres"; echo "${palabras[1]}"
str="a,b,c"; IFS=, read -ra trozos <<< "$str"; echo "${trozos[*]}" "${#trozos[@]}"
declare -a vacio=(); echo "vacío: ${#vacio[@]}"
m=(3 1 2); IFS=$'\n' ord=($(printf '%s\n' "${m[@]}" | sort)); unset IFS; echo "${ord[@]}"
declare -p a
nums=(1 2 3); suma=0; for n in "${nums[@]}"; do (( suma += n )); done; echo "suma=$suma"
echo "${nums[@]/#/n}" "${nums[@]/%/!}"
