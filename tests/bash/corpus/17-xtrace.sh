# set -x: what bash's trace shows for each kind of command.
set -x
v="a b"; e=
[[ -d /tmp && $v == "a b" ]]
[[ ! -f /no/such ]]
[[ $e ]] || [[ x == x* ]]
[[ $v != a* ]] || echo "no"
x=" sp "; echo "$x"
f() { local y=$(( $1 * 2 )); echo "$y"; }
f 21
a=(1 "2 3"); a+=(4); declare -A m=([k]=v)
set -- p q
for r; do :; done
for ((i = 0; i < 2; i++)); do :; done
echo $(echo $(echo hi))
n=3; (( n > $n - 1 )) || echo "not greater"
case "$v" in a*) echo match ;; esac
it="it's"; echo "$it"
declare x="a b" e2=
g() { local e3= z="p q"; }; g
export P=/x:/y Q
declare -A h=([a b]=1 [c]="x y"); declare -a b=(1 "2 3")
arr[2]="x y"; arr+=(z)
echo ""
x1=1 y1=2 true
readonly d=4 e=5
echo $( (echo a) )
c=([x[1]]=1); declare -p c
for ((i=0;  i<1  ;i++)); do :; done
set +x
echo done
