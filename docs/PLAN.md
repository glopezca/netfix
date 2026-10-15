# Plan de implementación (ECC planner)

## PRD

Clon funcional de Packet Tracer que se ejecuta en el navegador y permite practicar la
configuración de DHCP en Cisco IOS con la misma sintaxis, ayuda contextual y salidas
que el equipo real, incluidos los pools manuales (`host` + `client-identifier` /
`hardware-address`) y las reservas en pools de red (`address … client-id …`,
`address … hardware-address …`).

### Criterios de aceptación

- Todos los comandos de configuración de pool DHCP de IOS 15 se aceptan, se reflejan
  en `show running-config` y afectan a la asignación.
- `show ip dhcp binding | pool | server statistics | conflict`, `clear ip dhcp …`
  y `debug ip dhcp server events|packet` producen salida estilo IOS.
- Un PC con IP por DHCP obtiene dirección, máscara, puerta de enlace y DNS mediante
  DORA real a través de switches y, con `ip helper-address`, a través de un router relay.
- Abreviaturas, `?`, `Tab`, `do`, `no`, mensajes `% Invalid input` con `^`.
- Topologías guardables/cargables (JSON) y modo simulación con lista de eventos.

## Fases

| Fase | Entregable | Riesgo |
|------|-----------|--------|
| 0 | Andamiaje TS sin dependencias, ECC, CI | Registro npm bloqueado → se usa type-stripping nativo de Node y `tsc` |
| 1 | Motor CLI IOS: gramática, modos, abreviaturas, ayuda, errores, `show run` | Fidelidad de mensajes |
| 2 | Servidor DHCP: pools red/host, herencia, exclusiones, reservas, opciones, lease, conflictos, estadísticas | Reglas de coincidencia client-id vs MAC |
| 3 | Red: PCs, switch L2 con VLAN, router con subinterfaces, ARP, ping, DORA, relay, cliente `ip address dhcp` | Cola de eventos y temporización |
| 4 | UI tipo Packet Tracer: lienzo, cables, CLI, escritorio PC, simulación, persistencia | Usabilidad |
| 5 | Cobertura ≥ 80 %, revisión, README, publicación | Permisos de GitHub |

## Referencia de comandos DHCP soportados

Global: `service dhcp`, `ip dhcp pool`, `ip dhcp excluded-address`, `ip dhcp conflict logging`,
`ip dhcp ping packets|timeout`, `ip dhcp database`, `ip dhcp bootp ignore`,
`ip dhcp relay information option|trust-all`, `ip dhcp smart-relay`, `ip dhcp use …`.

Pool: `network`, `host`, `client-identifier`, `hardware-address`, `client-name`,
`address <ip> client-id <id> [ascii]`, `address <ip> hardware-address <mac> [tipo]`,
`reserved-only`, `default-router`, `dns-server`, `domain-name`, `netbios-name-server`,
`netbios-node-type`, `lease`, `option`, `bootfile`, `next-server`, `class`, `relay`,
`origin`, `import all`, `update arp`, `renew deny unknown`, `utilization mark`,
`subnet prefix-length`, `vrf`, `accounting`, `exit`, `end`, `no …`, `default …`.

Interfaz: `ip address dhcp [client-id <if>] [hostname <n>]`, `ip helper-address`,
`ip dhcp client …`, `ip dhcp relay information trusted`.

Exec: `show ip dhcp binding|pool|server statistics|conflict|database`,
`clear ip dhcp binding|conflict|server statistics`, `debug ip dhcp server events|packet`,
`release dhcp <if>`, `renew dhcp <if>`.

## Fase 6 · Server y servicios (v0.2)

| Paso | Entregable |
|---|---|
| 6.1 | Transporte: TCP simplificado (SYN, SYN/ACK, datos, FIN, RST) y DNS sobre UDP, visibles en simulación |
| 6.2 | `Host` común (IP, cliente DHCP, TCP, resolvedor) → `Pc` y `Server` (Server) |
| 6.3 | Servicios: DHCP estilo PT con reservas (motor IOS), DNS autoritativo, HTTP, SMTP/POP3/IMAP con reenvío por MX, SSH |
| 6.4 | Shells: bash de Ubuntu (`ip`, `dig`, `curl`, `ssh`, `systemctl`, `journalctl`, `ss`) y cmd de Windows (`ipconfig`, `nslookup`, `netstat`, `sc`, `net`) |
| 6.5 | UI: paleta Server, pestaña Servicios, navegador, correo, terminales; guardar `.json` con selector de archivo |
| 6.6 | Revisión (code-reviewer), regresiones, e2e, documentación |
| 6.7 | Compatibilidad: referencias de la v0.1 (`tests/compat/`), filtros de salida de `show` (`\| include`, `exclude`, `begin`, `section`), escenarios Tierra Media de ASIR2-SRI (UT2 y UT3) como tests |

## Fase 7 · Servicios avanzados, bash 5.3, editores y documentación (v0.3)

| Paso | Entregable | Riesgo |
|---|---|---|
| 7.1 | DHCP Server: reservas por MAC (semántica `hw-address` de Kea) o por Client-ID; concesiones automáticas identificadas por Client-ID o por MAC (`match-client-id`); convertir una concesión en reserva | Clave de binding calculada tras elegir el pool |
| 7.2 | DNS: origen de zona, `@`, nombres relativos autocompletados y absolutos con punto final; `$ORIGIN` en `db.*` | Compatibilidad con archivos v0.2 (sin origen = absolutos) |
| 7.3 | Intérprete bash 5.3 (`src/bash/`): lexer, parser, expansiones, aritmética, ejecutor con generadores (entrada interactiva), builtins, VFS por equipo, utilidades GNU, corpus de conformidad contra bash real | Alcance; bucles infinitos (presupuesto de pasos) y ReDoS |
| 7.4 | Editores `nano` y `vim` (motores puros + pantalla completa); edición remota por SSH sin tráfico por tecla | Captura de teclado en la UI |
| 7.5 | Pestaña «Documentación» con búsqueda; `help` y `man` reutilizan el contenido | Mantener la doc al día (test: todo comando documentado) |
| 7.6 | Revisión (code/security), e2e, versión 0.3.0, commit y push | — |

**Estado (v0.3.0):** fases 7.1–7.6 completadas. Revisión ECC: code-reviewer (recursión sin límite, `mv` sin metadatos, UID estables) y security-reviewer (ReDoS → `src/bash/regex-guard.ts`, cadenas de enlaces → límite de 40, restauración de ficheros restringida, sin setuid) corregidos con pruebas. 207 pruebas, cobertura 92 % líneas.

Decisiones: el VFS muestra los ficheros generados por los servicios como de solo lectura
(`Read-only file system`); `/var/www/html` se sincroniza con el servicio HTTP; los ficheros
del usuario se guardan en el `.json` de la topología (`hosts[].files`, con límites de tamaño).

## Fase 8 · Internet emulada, aplicaciones web y gestión remota (v0.4)

Petición: DNS con `@` y comodines; pestaña «Acerca de»; nombre de host editable y `hostnamectl`;
nube ISP (cable/xDSL/FTTx) con Internet emulada y DNS públicos; `whereis`, `batcat`, `mc`;
Apache2 configurable en `/etc/apache2`; WebGUI de routers/switches Cisco, Roundcube y gestión web
de Server; documentación al día. Decisiones confirmadas con el usuario: `@` en todos los campos
**y** registros comodín `*`; NAT tanto en el 2911 (`ip nat … overload`) como en el router del
operador de la nube; nube configurable con valores por defecto.

| Paso | Entregable | Riesgo / decisión |
|---|---|---|
| 8.1 | DNS: `@` en nombres y valores, registros `*.zona` (RFC 4592: solo si el nombre no existe) | Nodos vacíos intermedios no se sintetizan |
| 8.2 | «Acerca de»: `scripts/gen-about.mjs` genera `src/docs/about-data.ts` desde `package.json` y `LICENSE.md`; test de sincronía; Markdown seguro → bloques | Nunca `innerHTML`; solo enlaces http(s) |
| 8.3 | Pestaña «Equipo» (etiqueta y nombre de host) en PC/Server; `hostnamectl [set-hostname]`, `hostname NOMBRE`, `/etc/hostname` editable; se guarda en el `.json` | El prompt de bash conserva el nombre hasta una shell nueva (como bash real) |
| 8.4 | Dispositivo **Nube ISP**: puertos `Coaxial0-1` (DOCSIS), `DSL0-1` (ADSL2+/VDSL2), `Fibra0-1` (FTTH/FTTB); modo IP pública (DHCP /29) o router del operador (LAN + DHCP + NAT + redirección de puertos); núcleo `InternetCore` que une todas las nubes con saltos emulados, DNS 8.8.8.8/8.8.4.4 recursivos, zonas públicas y dominios registrados (delegación NS o registros A); NAT IOS (`ip nat inside/outside`, `source list … overload`, `static`, `pool`), ACL estándar, `traceroute`/`tracert` | Eventos virtuales «Internet» en simulación; un plano IP por puerto para LAN solapadas |
| 8.5 | `whereis`, `batcat` (resaltado y decoración), `mc` (dos paneles, F3/F4/F5/F6/F7/F8/F10) con interacción de pantalla completa del lado del servidor (también por SSH) | Cada tecla de `mc` por SSH es un segmento |
| 8.6 | Apache2 real: `apache2.conf`, `ports.conf`, `sites-*`, `mods-*`, `conf-*`; `Listen`, `<VirtualHost>`, `ServerName/Alias`, `DocumentRoot`, `Alias`, `Redirect`, `DirectoryIndex`, `Options Indexes`, `ErrorDocument`; `a2ensite/a2dissite/a2enmod/a2dismod/a2enconf/a2disconf`, `apache2ctl configtest/-S/-M`; los cambios se aplican con `reload/restart` | Ficheros borrados del sistema base se guardan como «borrados» |
| 8.7 | HTTP 1.1 ampliado: POST, cabeceras, cookies, Basic auth, redirecciones; navegador con formularios y estilos de una lista cerrada de clases; `curl -X -d -u -b -L -i -H`. WebGUI IOS (`ip http server`, `ip http port`, `ip http authentication enable|local`, `username`), casilla y puerto en la ventana del router/switch | Las páginas se generan con un constructor que escapa todo |
| 8.8 | Roundcube (alias `/roundcube` o puerto propio): login IMAP, bandeja, lectura, redacción con SMTP y reenvío por MX, enviados, borrar | Sesiones por cookie, sin estado persistente |
| 8.9 | Gestión web de Server al estilo WRT300N (alias `/admin` o puerto 10000, usuario/contraseña): Setup, servicios, administración, estado | Sin marcas comerciales |
| 8.10 | Documentación (pestaña y `man`), README, PLAN; revisión ECC (code + security), e2e, v0.4.0, commit y push | — |

**Estado (v0.4.0):** fases 8.1–8.10 completadas. Revisión ECC: security-reviewer (ReDoS de comodines en `Include`
→ comparador lineal para `* ? [...]`; bucle DNS al delegar en 8.8.8.8 → validación de dominios y SERVFAIL;
contraseñas guardadas enviadas en redirecciones a otro sitio → el navegador ya no las manda; inyección en
registros; `autocomplete` en formularios simulados; `cp -r` dentro de sí mismo) y code-reviewer (NAT que filtraba
direcciones privadas con el pool agotado → se descarta; PAT que podía ocupar un puerto publicado; bloques
públicos duplicados o reservados; estado de las líneas al cambiar el bloque; contadores tras `reload`; orden
de reglas dinámicas; refcount por regla; contadores de ACL) corregidos con pruebas (`tests/net/review-fixes.test.ts`).
272 pruebas, cobertura 93,5 % líneas; e2e con el laboratorio de Internet.

## Fase 9 · Rebranding a Netfix (v0.5)

Petición: la aplicación deja de llamarse netsim por coincidencia de marca y pasa a llamarse **Netfix**; la demo
pasa a `demo/netfix-lab.html`; el repositorio, a `glopezca/netfix`; los equipos pierden el sufijo «-PT» de Packet
Tracer (PC, Server). Imagen corporativa aportada por el usuario (logotipo, isologo con N e isologo sin N), que
asume el riesgo de marca tras el aviso.

| Paso | Entregable |
|---|---|
| 9.1 | Nombres, textos, etiquetas, ficheros (`dist/netfix.html`, `netfix.bundle.js`, documentación `netfix.ts`), CI y enlaces del repositorio |
| 9.2 | Compatibilidad: archivos `"format": "netsim"` y autoguardado `netsim:workspace:v1` se siguen abriendo |
| 9.3 | Marca: `assets/brand/` → `src/ui/brand-data.ts` (`npm run brand`, test de sincronía); logotipo en la barra superior y en «Acerca de», isologo con N grande, isologo sin N como viñeta de la documentación y favicon; marcas `web-brand-*` en las WebGUI (gestión web, Roundcube, IOS, webs de Internet, página por defecto de Apache) |
| 9.4 | v0.5.0, README, demo, push y cambio de nombre del repositorio |

## Fase 10 · Reservas DHCP en la gestión web y SSH al estilo OpenSSH (v0.6)

Petición: en la gestión web de Server, añadir direcciones reservadas por MAC o por identificador
(Client-ID); SSH compatible con OpenSSH: `~/.ssh`, `known_hosts` y autenticación por par de claves
en lugar de usuario y contraseña.

| Paso | Entregable | Riesgo / decisión |
|---|---|---|
| 10.1 | Reservas en la gestión web: tabla por pool, alta por MAC, Client-ID hexadecimal o texto ASCII, baja, y «Reservar» desde la tabla de concesiones; lógica común con la ventana del servidor (`services/dhcp-reservations.ts`) | Misma validación que la GUI (IP en la subred, sin duplicados) |
| 10.2 | Formatos de OpenSSH: SHA-256 propio, claves `ssh-ed25519`, `ecdsa-sha2-nistp256` y `ssh-rsa` con blobs reales (`AAAAC3NzaC1lZDI1NTE5…`), fichero privado `openssh-key-v1` (cifrado con frase de paso), huellas `SHA256:` y *randomart* | Dentro de cada formato va una clave Schnorr de 256 bits (`core/schnorr.ts`, BigInt): prueba real de posesión, de tamaño didáctico; se documenta |
| 10.3 | Cliente: `known_hosts` (primera conexión con huella, `yes/no/[fingerprint]`, aviso de clave cambiada), identidades `~/.ssh/id_*` e `-i`, frase de paso, permisos del fichero privado (`UNPROTECTED PRIVATE KEY FILE`), `-o StrictHostKeyChecking`, `PasswordAuthentication`, `PubkeyAuthentication`, `BatchMode`, orden remota `ssh host orden` | Windows guarda `known_hosts` en memoria (su terminal no tiene sistema de ficheros) |
| 10.4 | Servidor: claves de host en `/etc/ssh/ssh_host_*`, `~/.ssh/authorized_keys` con `StrictModes`, `sshd_config` editable (`PasswordAuthentication`, `PubkeyAuthentication`) que se aplica con `systemctl reload ssh`, registros `Accepted publickey … ED25519 SHA256:…` | Directivas no reconocidas se conservan como comentario |
| 10.5 | `ssh-keygen` (`-t -b -f -N -C -q -l -y -R -F -p -A`), `ssh-copy-id [-i -p -o -f -n]`; interruptores de autenticación en la ventana de Server y en la gestión web; documentación, revisión ECC (code + security), v0.6.0 | — |

**Estado (v0.6.0):** fases 10.1–10.5 completadas. Revisión ECC en dos rondas:
- security-reviewer: la firma simulada solo usaba datos públicos (se podía entrar con el `.pub` ajeno) y el servidor no probaba su clave de host → firmas Schnorr, prueba de host con *nonce* del cliente, ficheros privados que deben corresponder a su semilla; reto aleatorio de un solo uso por conexión ligado a la IP y a la clave de host (sin *replay*); `AllowUsers/DenyUsers/AllowGroups/DenyGroups` acumulativos con patrones `usuario@ip`, también para cuentas sin usuario Linux; `PermitRootLogin` y `MaxAuthTries` aplicados; opciones de `authorized_keys` (`from=` aplicado, el resto rechazado); `Match`, `ForceCommand`… rechazados en vez de ignorados; presupuesto de `Include`; cupo de inicios de sesión pendientes por IP; `StrictModes` hasta `/`.
- code-reviewer: rutas relativas de `-i` desde el directorio de trabajo, palabras de la orden remota que no son opciones de `ssh`, `ssh-copy-id` sin romper un `authorized_keys` sin salto final, `-q` que ya no sobrescribe, `ssh-keygen -A`, `StrictHostKeyChecking=no` con clave cambiada, `touch` y `umask` (también de root, 022), `chown -R` recursivo.
Fuera de alcance (documentado): los datos viajan sin cifrar en los paquetes simulados; grupo de 256 bits.

## Fase 11 · Netfix internacional, router Linux, VPN y apps de PC (v0.7)

Petición: aplicación internacionalizable (es-ES y en-GB); pestaña «Donaciones / Donations» con PayPal sin
servidor (paypal.me/infogerman, 5/10/15/20 € u otro importe); router «Linux · 2911» (mismo hardware que el
2911 y el software de Server) con `net.ipv4.ip_forward` por sysctl y cortafuegos nftables, configurables desde
la CLI, la pestaña Servicios y una WebGUI estilo WRT300N; en los PC, apps de cliente SSH (claves y
known_hosts) y SFTP estilo FileZilla; bind9 resuelve nombres públicos reenviando a 8.8.8.8/8.8.4.4 a través de
las nubes; sucursales unidas por VPN; documentación y laboratorios (conectividad y bastionado); la GUI refleja
lo que se cambia en la terminal Linux (red y nombre de host); créditos en mc; interfaz fluida en móvil,
tableta y touchpad.

Decisiones confirmadas con el usuario: se traduce todo (UI, WebGUI, laboratorios y documentación); la salida de
IOS, Linux y Windows sigue literal en inglés como en el equipo real; WireGuard (`wg`, `wg-quick`,
`/etc/wireguard/wg0.conf`) en el router Linux e IPsec site-to-site en el 2911, cada uno con los de su tipo;
paypal.me/infogerman; una única versión v0.7.0, por fases internas con TDD.

Decisiones de diseño (por defecto, revisables):
- El idioma es estado de presentación (`src/i18n`, hoja sin dependencias). Las webs simuladas eligen idioma por
  `Accept-Language` del navegador de Netfix. `man`, `help` y las pistas propias de Netfix siguen el idioma; los
  mensajes de los programas, no.
- Router Linux: `LinuxRouter extends Server`, `kind: 'linuxrouter'`, puertos `GigabitEthernet0/0-2` ↔ `eth0-2`.
  Lo persistente son ficheros (netplan, `sysctl.conf`, `nftables.conf`, `wg0.conf`) y unidades habilitadas:
  al abrir un `.json` «arranca»; lo hecho solo con `ip`, `nft` o `sysctl -w` sin guardar se pierde.
- IPsec con ESP entre IP públicas (sin NAT-T; nube en modo IP pública); WireGuard (UDP) atraviesa el NAT del
  operador. Claves de WireGuard e IKE con el grupo didáctico de `core/schnorr.ts`. Sin licencia securityk9.
- Texto de donaciones: «Si quieres apoyar este proyecto para que siga mejorando y pueda hacer frente a los
  gastos de desarrollo, puedes hacer una donación.»

| Paso | Entregable | Riesgo / decisión |
|---|---|---|
| 11.1 | Base i18n: `src/i18n` (locale, `t()`, catálogos es-ES/en-GB con paridad de tipos), selector ES/EN, `<html lang>`, cambio sin recargar | `src/i18n` no importa nada de `src/`; guardián de literales que solo puede menguar |
| 11.2 | Interfaz adaptable: `dvh`, barra plegable, ventanas a pantalla completa en móvil, zoom y desplazamiento del lienzo (pellizco, touchpad, botones), toque/doble toque, barra de teclas de terminal | Teclados virtuales sin `key`; no romper escritorio |
| 11.3 | Pestaña Donaciones: `paypalMeUrl(importe)` validado, 5/10/15/20 € y otro | Solo enlace pulsado por el usuario; sin SDK ni datos |
| 11.4 | Créditos en mc (F1 y menús → «Acerca de Netfix») | También por SSH |
| 11.5 | `ip addr/route/link` de escritura, netplan real (`netplan apply/try`), `dhclient -r` y `hostnamectl` notifican; paneles en vivo | Estado en ejecución vs persistente |
| 11.6 | DNS recursivo: forwarders, recursión, caché, RD/RA, `named.conf.options`, 8.8.8.8 ampliado | Sin bucles; recursión solo `localnets` |
| 11.7 | sysctl y nftables: motor puro (tablas, cadenas, ganchos, conntrack, NAT), `sysctl`, `nft`, `nftables.service` | Parser con presupuesto |
| 11.8 | Router Linux (hardware 2911, software de Server, varias NIC, reenvío por `ip_forward`) | `Host` de una sola NIC: generalizar tras `nicsOf` |
| 11.9 | Paneles sysctl/cortafuegos/VPN en Servicios y WebGUI WRT300N del router Linux | Sesión y escape como en la gestión web |
| 11.10 | ACL extendidas IOS y `ip access-group` | Compatibilidad de ACL estándar |
| 11.11 | IPsec site-to-site en el 2911 (isakmp, transform-set, crypto map, `show crypto …`) | La PSK no viaja |
| 11.12 | WireGuard (`wg`, `wg-quick`, `wg0.conf`, AllowedIPs, keepalive) | Solo entre routers Linux |
| 11.13 | Subsistema SFTP en sshd | Credenciales del usuario en el VFS |
| 11.14 | Apps del PC: cliente SSH (perfiles, claves, known_hosts) y SFTP tipo FileZilla | Lógica fuera de `src/ui` |
| 11.15 | Laboratorios: VPN IPsec y WireGuard, DNS que reenvía, router Linux con NAT/DMZ, SSH/SFTP; bastionado (sshd, nftables, ACL) | Cada lab comprueba lo permitido y lo bloqueado |
| 11.16 | Traducción del resto (webs simuladas, validaciones, ventanas) | Guardián a cero |
| 11.17 | Documentación en los dos idiomas (`src/docs/en`, `docs/sets.ts`; man/help siguen el idioma) y grupo Seguridad y VPN | Paridad comprobada por `tests/docs/docs-en.test.ts` (órdenes de los bloques `code` intactas) |
| 11.18 | Revisión ECC (code, typescript, security, network-config), e2e escritorio y táctil, v0.7.0 | — |

**Estado (v0.7.0):** fases 11.1–11.18 completadas, 406 pruebas, cobertura del núcleo 95 % líneas / 89 % funciones,
e2e en escritorio (1400 px), móvil y tableta en los dos idiomas. Revisión ECC (code, typescript, security,
network-config): sin hallazgos críticos; corregidos los altos (iifname en postrouting, ACL crypto con varias líneas,
vista y modo al cambiar de idioma, mensajes de paneles) y la mayoría de los medios. Pendientes, documentados como
límites: autenticación real de los mensajes de WireGuard (réplica de la iniciación), errores ICMP «related» sin NAT
inversa y `reject with` que siempre envía «unreachable».

Diseño detallado de 11.7–11.14 (revisión del agente planner):
- Ganchos opcionales en `StackHost` (`net/ipstack.ts`): `input?` (tras decidir que el paquete es para el
  equipo, antes del eco ICMP y de `deliver`), `output?` (en `send`/`echo`), `postrouting?` (en `sendVia`),
  `prerouting?` (ya existe; dnat y deshacer NAT) y `L3Iface.pointToPoint?` (sin ARP, para `wg0`). Sin
  implementar no cambian nada (`RouterPlane`, `CloudPort`).
- `net/conntrack.ts` puro (5-tupla en los dos sentidos; NEW/ESTABLISHED/RELATED/INVALID; plazos con el reloj
  simulado; límite de entradas). Motor nft puro en `src/net/nft/` (`model`, `lexer`, `parse`, `format`, `eval`,
  `nat`), con presupuesto de análisis. `masquerade`/`snat`/`dnat` reutilizan `NatTable` de `net/nat.ts`.
- El cortafuegos (cadenas `input`/`output`) y `sysctl` también van en Server, para los laboratorios de
  bastionado; el router Linux añade `forward` y NAT.
- Los tipos de equipo se consultan con `devices/kinds.ts` (hoja), nunca con `instanceof Server` desde
  `shells/` (ciclo `server → ssh-service → host-system`). `Host` generaliza la NIC tras `nics()`; PC y Server
  siguen usando la NIC 0.
- La GUI (Servicios) y la WebGUI aplican **y guardan** (`/etc/nftables.conf`, `/etc/sysctl.d/99-netfix.conf`);
  la CLI cambia el estado en ejecución hasta que se guarda, como en el equipo real.
- IPsec: la NAT de salida va antes del crypto map; la exención (`deny ip LAN1 LAN2`) necesita ACL extendidas
  (11.10). ESP entre IP públicas; la PAT descarta el ESP crudo. La PSK no viaja (`sha256(psk‖Ni‖Nr)`).
- SFTP: petición/respuesta sobre la sesión SSH autenticada, con el `Cred` del usuario en el VFS (única
  autoridad de permisos); `Subsystem sftp` en `sshd_config`. La app PuTTY reutiliza la terminal y `~/.ssh`.
- Otras decisiones: web sin `Accept-Language` → es-ES; `nc` y un subconjunto de `nmap` (`-sT -sU -sn -p -Pn`)
  solo para verificar el filtrado; IPsec solo 2911↔2911 y WireGuard solo Linux↔Linux.

## Fase 12 · Coherencia de la interfaz (v0.7.1)

| Paso | Entregable | Riesgo / decisión |
|---|---|---|
| 12.1 | Máscara no válida: `Bad mask 0x… for address …` en IOS (máscaras no contiguas) y mensaje propio de máscara en Configuración IP | Formato literal de IOS |
| 12.2 | Paleta: PC, Servidor, Switch IOS, Router IOS (2911), Router Linux (Ubuntu, mismo símbolo de router), Nube (ISP → Internet) | Solo nombres y orden; el tipo guardado no cambia |
| 12.3 | Router Linux → Servicios empieza por Parámetros (sysctl), Firewall y VPN; la documentación insiste en `net.ipv4.ip_forward = 1` | — |
| 12.4 | Server sin paneles de núcleo ni cortafuegos (ventana y pestaña Seguridad de la gestión web); `sysctl`/`nft` siguen en su terminal | Topologías guardadas con cortafuegos en un Server lo conservan |
| 12.5 | «Equipo» primera pestaña en todos los equipos; panel nuevo para Router IOS y Switch IOS (nombre visible, `hostname`, interfaces) | Validación del hostname igual que la CLI |
| 12.6 | «Símbolo del sistema» → «Terminal Windows»; documentación, laboratorios y traducciones coherentes | Paridad es/en comprobada por prueba |

**Estado:** completada. Revisión ECC (code-reviewer): sin hallazgos críticos ni altos; corregidos los dos medios
(validación del hostname IOS y título de la ventana tras un cambio desde la CLI).

## Fase 13 · Pestaña Interfaces en todos los equipos (v0.7.2)

| Paso | Entregable | Riesgo / decisión |
|---|---|---|
| 13.1 | Router IOS y Switch IOS: estado, MAC y extremo del cable de cada interfaz; descripción, dirección (puertos enrutados y SVI), modo switchport y VLAN de acceso, shutdown | Se teclean en una sesión de la CLI (no applyConfig: entrar en la interfaz no la enciende); solo se envía lo que cambia; no entra en `show history`; registra %SYS-5-CONFIG_I |
| 13.2 | PC y Server: tarjetas de red (MAC, enlace, dirección, velocidad, extremo) y estado del puerto (`ip link set`) | La dirección sigue en Configuración IP |
| 13.3 | Router Linux: su pestaña Interfaces pasa a segunda y muestra MAC y extremo del cable | — |
| 13.4 | Nube ISP: resumen de las seis líneas (acceso, modo, lado del cliente, extremo) | Solo lectura; se configuran en Líneas |

**Estado:** completada. Revisión ECC (code-reviewer): sin críticos ni altos; corregidos los cuatro medios (los valores rechazados
se conservan y solo se redibuja la fila, subinterfaces/SVI/loopback sin cable ni MAC propios, sesión sin efectos en el historial,
solo órdenes de lo que cambia) y los bajos (VLAN solo en modo access, «dúplex completo» traducido).

## Fase 14 · Créditos de Midnight Commander (v0.7.4)

F2/F9 en mc abren los créditos en el visor (con desplazamiento, cabe en cualquier pantalla): los de Netfix y los reales de
GNU Midnight Commander 4.8.33 (copyright de la FSF, GPL v3+, sitio, fundador y mantenedores según midnight-commander.org),
con la aclaración de que Netfix reproduce su interfaz sin incluir su código. `mc --version` usa la misma versión.

**v0.7.5:** los créditos añaden a los traductores de mc al español (David Martin, Ismael Olea, Slava Zanko, Yury V. Zaytsev)
y al inglés británico (Andi Chandler, Yury V. Zaytsev), según las cabeceras de `po/es.po` y `po/en_GB.po`, sin correos,
y una referencia a los equipos de Transifex del resto de idiomas.

## Fase 15 · Dibujo sobre el área de trabajo (v0.8.0)

| Paso | Entregable | Riesgo / decisión |
|---|---|---|
| 15.1 | `net/annotations.ts`: rectángulo, elipse, línea, mano alzada y texto; color #rrggbb, relleno, grosor, nombre del área; inmutables; JSON validado (límites de número, puntos, texto y coordenadas); `Topology.annotations`, campo opcional del archivo v2 | Archivos anteriores sin dibujos siguen abriéndose |
| 15.2 | Capa SVG bajo cables y equipos (`ui/draw-layer.ts`), barra flotante (`ui/draw-bar.ts`) con nueve colores, RGB, relleno y grosor; seleccionar, mover, borrar, renombrar con doble clic | El interior de un área no captura el puntero (solo borde y texto, con trazo de impacto ancho); redibujo solo si cambian los dibujos |
| 15.3 | Áreas de los laboratorios calculadas a partir de los equipos (`net/lab-areas.ts`): privadas, Internet, DMZ, invitados, servidores, VLAN, túneles | Textos en el idioma de la interfaz; prueba de que no se solapan |
| 15.4 | Documentación es/en (página «Dibujo»), README, e2e | — |

**Estado:** completada (v0.8.0, 420 pruebas, cobertura del núcleo 95 % líneas / 89 % funciones; e2e de dibujo, arrastre,
guardado y móvil). Revisión ECC (code-reviewer): sin críticos; corregidos los dos altos (el redibujo periódico cancelaba el
arrastre de un dibujo; un trazo «punto» hacía ilegible el archivo y el autoguardado) y los medios (selección al cambiar de
topología, un solo puntero y nada durante el pellizco, cancelación sin mover, color RGB agrupado por fotograma, el dibujo
nuevo no queda seleccionado, el servidor DHCP falso dentro del área de su LAN) y bajos (ids únicos y acotados, límite de
500 sin falsos positivos, trazos de hasta 1000 puntos). Un dibujo malformado en un archivo se omite; el archivo se abre.

## Fase 16 · Nueva identidad visual (v0.8.1)

Logotipo «NETFIX» con letras dibujadas como trazados de red y nodos, isotipo principal de la N (dos nodos y un rombo:
«Acerca de», donaciones y favicon) e isotipo secundario de la X (cuatro nodos alrededor de un rombo: viñetas de la
documentación y marcas pequeñas de las webs simuladas). Los originales en fondo negro se pasan a transparencia con borde
suave y color recuperado, se recortan y se escalan a los tamaños de `assets/brand/`; `npm run brand` regenera
`src/ui/brand-data.ts` (cada imagen por debajo de 40 000 caracteres en base64, comprobado por prueba).

**v0.8.2:** favicon a partir del isotipo de la N, recortado sin margen (legible a 16 px), y `apple-touch-icon` de 180 px
con la N sobre el negro del original. Se declaran en el HTML (`dist/index.html` los sirve como ficheros; `netfix.html`,
la demo y `artifact.html` los llevan como data URI), de modo que se ven antes de ejecutar el script.

## Fase 17 · Página de presentación en GitHub Pages (v0.9.0)

| Paso | Entregable | Riesgo / decisión |
|---|---|---|
| 17.1 | Capturas reales de la app en cada idioma (`site/img/`, WebP): área de trabajo con el laboratorio DMZ, CLI IOS, cortafuegos del router Linux y terminal en un móvil | Ligeras (< 90 KB cada una) |
| 17.2 | `site/index.template.html` + `site/i18n/{en-GB,es-ES}.json` + `site/site.css`; `scripts/site-render.mjs` (puro, escapa todo el texto) y `scripts/build-site.mjs` → `_site/` (inglés británico en la raíz, español en `es/`, la app en `app/`) | Una clave ausente rompe el build; `hreflang` y conmutador de idioma |
| 17.3 | Estructura AIDA: promesa y CTA, cifras verificables, problema → solución, funciones con capturas, laboratorios, públicos, donaciones (área discontinua como los dibujos de la app, importes de PayPal.Me), preguntas frecuentes, CTA final, aviso de marcas de Cisco | Sin testimonios inventados ni cifras infladas |
| 17.4 | CI: el job `pages` construye y publica `_site`; pruebas `tests/site/` (paridad de claves, enlaces a la app, al repositorio y a PayPal, escape) | En el repositorio, Settings → Pages → Source: «GitHub Actions» |

**Estado:** completada (v0.9.0). Las áreas de los laboratorios se ensanchan para que quepa su nombre (en el de bastionado se
separan los switches para que no se solapen).

**v0.9.1:** borrar dibujos. La barra de dibujo tiene «Borrar dibujo» (activo con un dibujo seleccionado; también Supr) y
«Borrar todos» (con confirmación; quita también las áreas del laboratorio, nunca equipos ni cables). Con la herramienta
Eliminar basta tocar el interior de un área. `Topology.clearAnnotations()`; la selección de la capa de dibujo se notifica
a `DrawState` (un solo punto, `setSelected`) y se pierde al cerrar la barra. Revisión ECC: sin críticos ni altos.

**v0.9.2:** Supr o Retroceso borran el equipo (con sus cables) o el cable seleccionado. Ya existía el atajo, pero el
redibujo periódico del área de trabajo sustituía el elemento enfocado y el foco caía en `body`, con lo que la tecla se
perdía: ahora `Canvas.render()` devuelve el foco al equipo redibujado y, si nada tiene el foco, la app pasa las teclas a
`Canvas.handleKey()` (nunca desde campos de texto, selectores ni editables). e2e con espera tras seleccionar.
Revisión ECC: corregido el alto (con la ventana de un equipo abierta y el foco en `body`, Retroceso borraba el equipo
seleccionado): la app solo reenvía las teclas si el último clic fue en el área de trabajo; e2e del caso.

**v0.9.3:** deshacer y rehacer (Ctrl+Z; Ctrl+Y o Ctrl+Mayús+Z; botones ↶ ↷ de la paleta) de los cambios del área de
trabajo: añadir, borrar y mover equipos, conectar y quitar cables, y dibujos (los cambios rápidos de color se agrupan).
`net/edit-history.ts` (100 pasos, uno por topología): un equipo borrado se guarda como objeto y vuelve igual (configuración,
archivos, túneles) con sus cables si los puertos siguen libres; si su nombre o su bloque público se dieron a otro
equipo, toma uno libre. La configuración escrita en un equipo (CLI, paneles) no entra, como en Packet Tracer; dentro de
ventanas y campos de texto Ctrl+Z sigue siendo de ellos. Revisión ECC: corregidos los dos altos (nombre y bloque
público repetidos al deshacer) y los cables que no se pueden reconectar se indican en la pista.

**v0.9.4:** «Acerca de» describe Netfix como simulador orientado a los servicios en red e Internet y a las tareas
desde sistemas operativos reales emulados (traducido: `about.description`; el español es la descripción de
`package.json`). La cuenta SSH `admin` de los laboratorios (servidores, WireGuard, SSH/SFTP, bastionado) pasa de
`cisco` a `netfix`, también en el ejemplo `username admin … secret` de la gestión web de IOS, la documentación, los
enunciados y el README.

**v0.9.5:** la gestión web de Server y Router Linux usa por defecto la misma cuenta que el SSH de los laboratorios,
`admin`/`netfix` (antes `admin`/`admin`), por simplicidad; documentación es/en (tabla de credenciales y página de la
gestión web), enunciado del laboratorio de servidores, README y pruebas.

**v0.9.6:** el aviso de copyright del código (`LICENSE.md`, visible en «Acerca de») describe Netfix como la página
«Acerca de», sin mencionar Cisco ni IOS (lo comprueba una prueba). El apartado «Marcas» se mantiene: es el aviso
legal de que Netfix no tiene relación con Cisco.
