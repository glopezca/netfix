# Realistic administration scripts
cat > usuarios.csv <<'CSV'
nombre,uid,grupo,shell
ana,1001,profes,/bin/bash
luis,1002,alumnos,/bin/bash
eva,1003,alumnos,/usr/sbin/nologin
CSV
tail -n +2 usuarios.csv | while IFS=, read -r nombre uid grupo shell; do
  case $shell in */nologin) estado="sin acceso" ;; *) estado="interactivo" ;; esac
  printf '%-5s %5d %-8s %s\n' "$nombre" "$uid" "$grupo" "$estado"
done
declare -A cuenta
while IFS=, read -r _ _ grupo _; do [[ $grupo == grupo ]] && continue; (( cuenta[$grupo]++ )); done < usuarios.csv
for g in alumnos profes; do echo "$g: ${cuenta[$g]}"; done
ips=(192.168.10.1 192.168.10.64 10.0.0.300 abc)
valida() { local IFS=.; local -a o=($1); [[ ${#o[@]} -eq 4 ]] || return 1; for x in "${o[@]}"; do [[ $x =~ ^[0-9]+$ ]] && (( x <= 255 )) || return 1; done; }
for ip in "${ips[@]}"; do if valida "$ip"; then echo "$ip válida"; else echo "$ip NO válida"; fi; done
red() { local IFS=.; read -r a b c d <<< "$1"; echo "$a.$b.$c.0/24"; }; red 192.168.10.77
log=$(printf 'Oct 11 10:00 sshd[1]: Failed password for root from 10.0.0.5\nOct 11 10:01 sshd[1]: Failed password for ana from 10.0.0.9\nOct 11 10:02 sshd[1]: Accepted password for ana from 10.0.0.9\nOct 11 10:03 sshd[1]: Failed password for root from 10.0.0.5\n')
echo "$log" | grep 'Failed' | awk '{print $NF}' | sort | uniq -c | sort -rn
echo "$log" | sed -n 's/.*for \([a-z]*\) from.*/\1/p' | sort -u | paste -sd,
total=0; for f in 3 5 8; do total=$(( total + f )); done; echo "media: $(( total / 3 )) resto: $(( total % 3 ))"
dias=(lunes martes miércoles); for i in "${!dias[@]}"; do echo "$i ${dias[i]^}"; done
mensaje="ERROR: disco lleno"; nivel=${mensaje%%:*}; texto=${mensaje#*: }; echo "[$nivel] $texto"
backup() { local dir=$1 dest=${2:-copia}; [[ -d $dir ]] || { echo "falta $dir" >&2; return 2; }; mkdir -p "$dest"; cp -r "$dir"/. "$dest"/; echo "copiados $(ls "$dest" | wc -l) elementos"; }
mkdir -p datos; touch datos/{a,b,c}.dat; backup datos; backup nada 2>&1; echo "status=$?"
trap 'echo "limpieza al salir"' EXIT
set -e; true; echo "fin del script"
