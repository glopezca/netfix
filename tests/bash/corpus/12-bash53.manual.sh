# bash 5.3 features (expected output written by hand from the bash 5.3 manual)
echo "$BASH_VERSION ${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"
x=1
y=${ x=2; echo "cur:$x"; }
echo "$y $x"
z=$(x=3; echo "sub:$x"); echo "$z $x"
r=${| REPLY="valor $x"; }; echo "$r [${REPLY-unset}]"
f() { echo "salida"; return 3; }; v=${ f; }; echo "$v $?"
mkdir -p lib; echo 'echo "desde lib"' > lib/mod.sh; source -p ./lib mod.sh
compgen -V lista -W "alfa beta gamma" b; echo "${lista[@]}"
printf '%s' 1234567890 > b_grande; printf 'x' > a_peq
GLOBSORT=size; echo *_*; GLOBSORT=-name; echo *_*; unset GLOBSORT
[[ -n $BASH_MONOSECONDS ]] && echo monosegundos
