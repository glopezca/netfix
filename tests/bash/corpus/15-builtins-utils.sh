# directory stack, aliases, traps, hash/type/enable, and file information utilities
mkdir -p uno/dos tres
pushd uno >/dev/null; pushd dos >/dev/null; dirs -v | sed "s#$PWD#X#; s#/tmp/[^ ]*#T#g" | awk '{print $1}'
popd >/dev/null; basename "$PWD"; popd >/dev/null
cd -P uno; basename "$PWD"; cd - >/dev/null; basename "$OLDPWD"
shopt -s expand_aliases; alias saluda='echo hola'; saluda mundo; alias saluda; unalias saluda; alias saluda 2>&1 | sed 's/^.*: //'
trap 'echo atrapado' USR1; trap -p USR1; kill -USR1 $$; trap - USR1; trap -p USR1; echo fin-trap
f() { :; }; type -t f echo ls if; type -a echo | head -1
enable -n echo; type -t echo; enable echo; type -t echo
command -v ls cd >/dev/null && echo cv
printf 'abc' > a.txt; ln -s a.txt enl
basename /a/b/c.txt .txt; basename -a /x/y /z/w; dirname /a/b/c /solo
readlink enl; realpath -s enl | sed "s#$PWD#X#"
stat -c '%n %s %F' a.txt uno; stat -c %F enl; stat -L -c %F enl
file a.txt uno enl | sed 's/: */:/'
du -s uno | awk '{print $2}'
umask 027; umask; umask -S; umask 022
let "x = 3 * 4" "y = x + 1"; echo $x $y
times >/dev/null && echo times-ok
getopts ab: opt -b val; echo "$opt $OPTARG $OPTIND"
mapfile -t arr < <(printf 'l1\nl2\n'); echo "${#arr[@]} ${arr[1]}"
read -r -a parts <<< "p q r"; echo "${parts[2]}"
printf -v fmt '%05.1f' 3.14159; echo "$fmt"
caller 0 2>/dev/null || echo no-caller
compgen -W "alfa beta alma" al
false; echo "${PIPESTATUS[0]}"
true | false | true; echo "${PIPESTATUS[@]}"
wait; echo waited
jobs; echo jobs-ok
