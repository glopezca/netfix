# Quoting, word splitting and globbing
a="uno   dos"
printf '<%s>\n' $a "$a" '$a' "\$a" $'tab\there' "x"'y'"z"
IFS=: read -r f1 f2 f3 <<< "a:b::d"
echo "[$f1][$f2][$f3]"
IFS=, ; set -- $'x,y,,z'; echo "$#: $1|$2|$3|$4"
unset IFS
v="a b c"; set -- $v; echo $#
set -- "a b" c; for w in "$@"; do echo "[$w]"; done; for w in $@; do echo "<$w>"; done
echo "$*" "${*}"; IFS=-; echo "$*"; unset IFS
empty=""; set -- $empty; echo "args: $#"; set -- "$empty"; echo "args: $#"
set --; for x in "$@"; do echo nunca; done; echo "a${@}b"
echo "\\" '\\' "\"" 'a\nb' "a\nb"
echo ~ | sed 's|/home/alumno|HOME|' 2>/dev/null || echo "~"
echo {a,b}{1,2} {1..10..3} {a..c} x{y,}z
echo "{a,b}" '{a,b}' \{a,b\}
mkdir -p g && cd g && touch b.txt a.txt c.log .h
echo *.txt; echo *; echo .*; echo [ab]*; echo nada*; shopt -s nullglob; echo nada* fin; shopt -u nullglob
shopt -s dotglob; echo *; shopt -u dotglob
shopt -s extglob
echo !(*.txt); echo @(a|c).*; cd ..
echo "a$"; echo b
echo "x$" "y"
echo $"hola"
echo "$'x'"
