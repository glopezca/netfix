# Subscripts with blanks inside an array literal, and how declare -p quotes associative keys.
a=([1 + 1]=two [3]=three); declare -p a
declare -A s=([a b]=1); declare -p s
declare -A t=([*]=star); declare -p t
declare -A u=(["x\"y"]=q); declare -p u
declare -A w=([plain]=v); declare -p w
k="p q"; declare -A m=([$k]=1); echo "${m[p q]}"
