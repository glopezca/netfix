# Associative arrays list their keys in the order of bash's hash table, not in insertion order.
declare -A a
a[x]=1 a[y]=2 a[z]=3 a[foo]=4 a[bar]=5 a[10]=7 a[1]=8 a[ñandú]=6
echo "${!a[@]}"
echo "${a[@]}"
unset 'a[x]'; a[x]=9; a[y]=0
echo "${!a[@]}"
declare -p a
declare -A b=([uno]=1 [dos]=2 [tres]=3 [cuatro]=4 [cinco]=5)
for k in "${!b[@]}"; do printf '%s=%s ' "$k" "${b[$k]}"; done; echo
declare -A c
for i in $(seq 1 40); do c[k$i]=$i; done
echo "${!c[@]}"
c2=$(declare -p c); echo "${#c2}"
