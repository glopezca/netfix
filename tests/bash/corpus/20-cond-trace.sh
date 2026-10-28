# set -x on [[ ]]: a ! before a parenthesised group is not shown, a ! before a test is.
set -x
[[ ! ( a == b ) ]]
[[ ! a == b ]]
[[ ! ( a == b && c == d ) || -n x ]]
[[ ( a == a ) ]]
[[ ! ( ! -z x ) ]]
set +x
f() { [[ ! ( a == b ) && -n x ]]; }
declare -f f
