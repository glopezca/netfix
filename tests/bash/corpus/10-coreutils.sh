# Text and file utilities
printf 'manzana 3\npera 10\nuva 2\nmanzana 7\nkiwi 2\n' > frutas.txt
sort frutas.txt; echo --; sort -k2 -n frutas.txt; echo --; sort -k2,2nr -k1 frutas.txt; echo --; sort -u -k1,1 frutas.txt
cut -d' ' -f1 frutas.txt | sort | uniq -c; cut -c1-3 frutas.txt | head -2
awk '{s[$1]+=$2} END {for (k in s) print k, s[k]}' frutas.txt | sort
awk -F' ' '$2 > 2 {print NR": "$1}' frutas.txt; awk 'BEGIN{printf "%-8s|%5.2f\n", "x", 3.14159}'
awk '{print length($1), toupper(substr($1,1,1)) substr($1,2)}' frutas.txt | head -3
sed 's/manzana/MANZANA/' frutas.txt | head -1; sed -n '2,3p' frutas.txt; sed '/kiwi/d; s/[0-9]\+/<&>/' frutas.txt; sed -E 's/^(\w+) ([0-9]+)$/\2:\1/' frutas.txt | tail -1
sed -n '$=' frutas.txt; sed '1i\cabecera' frutas.txt | head -2; sed 'y/abc/ABC/' <<< "abcd"
grep -c manzana frutas.txt; grep -n 'a 1' frutas.txt; grep -v -i MANZANA frutas.txt | wc -l; grep -E '^(uva|kiwi)' frutas.txt; grep -o '[0-9]\+' frutas.txt | tr '\n' ','; echo
grep -w pera frutas.txt; grep -x 'uva 2' frutas.txt; grep -q nada frutas.txt || echo "no hay"
tr 'a-z' 'A-Z' <<< "hola"; tr -d 'aeiou' <<< "murcielago"; tr -s ' ' <<< "a   b    c"; echo "a:b:c" | tr ':' '\n'
wc -l frutas.txt; wc -w < frutas.txt; head -n 2 frutas.txt; tail -n 1 frutas.txt; tail -n +4 frutas.txt; head -c 7 frutas.txt; echo
seq 3; seq 2 2 8 | paste -sd+; seq -w 8 11; echo $(seq 1 5 | awk '{s+=$1} END {print s}')
expr 3 + 4; expr 10 / 3; expr length "hola"; expr "abc" : 'a\(.*\)'
rev <<< "abc"; tac frutas.txt | head -1; nl frutas.txt | head -2; fold -w 5 <<< "abcdefghij"
mkdir -p d/e/f; touch d/a.txt d/e/b.txt d/e/f/c.log; find d -name '*.txt' | sort; find d -type d | sort; find d -name '*.log' -exec basename {} \;
ls d; ls -a d | head -3; ls -1 d/e; cp -r d d2; ls d2/e; mv d2 d3; ls d3; rm -r d3; ls -d d*
printf '%s\n' a b c | xargs echo; printf '%s\n' 1 2 3 4 | xargs -n 2 echo; echo uno dos | xargs -I {} echo "[{}]"
basename /a/b/c.txt .txt; dirname /a/b/c.txt; echo "aGVsbG8=" | base64 -d; echo; echo -n hello | base64
printf 'a\nb\nc\n' > x; printf 'a\nB\nc\nd\n' > y; diff x y; echo "diff=$?"; diff -u x y | tail -n +3
cat -n x; cat x y | sort | uniq -d; comm -12 x y; ln -s x enlace; cat enlace; readlink enlace
chmod 600 x; [ -r x ] && echo legible; chmod u+x,g+r x; [ -x x ] && echo ejecutable
