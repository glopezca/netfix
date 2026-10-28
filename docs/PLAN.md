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

**v0.9.7:** el apartado «Marcas» de `LICENSE.md` (y el pie de la página de presentación) recoge también Microsoft y
Windows como marcas de Microsoft Corporation, con la misma aclaración de independencia que para Cisco.

## Fase 18 · Terminal Windows sobre el sistema de archivos del equipo (v0.10.0)

| Paso | Entregable | Riesgo / decisión |
|---|---|---|
| 18.1 | `shells/win-path.ts`: C:\ es la raíz /, \ o / como separador, nombres sin distinguir mayúsculas (se busca la entrada real), línea de cmd con comillas y `>`/`>>`, comodines * ? | Otras unidades: «The system cannot find the drive specified.» |
| 18.2 | `shells/win-files.ts`: cd/chdir, dir [/b], md/mkdir, rd/rmdir [/s], del/erase, copy, move, ren, type, echo y redirección de cualquier orden, con los mensajes de cmd.exe | La terminal actúa como la cuenta Linux del equipo (alumno en PC, admin en Server) y respeta sus permisos («Access is denied.»); empieza en su carpeta personal (C:\home\alumno) |
| 18.3 | `edit`: motor `editors/msedit.ts` (Microsoft Edit: barra de menús y de estado, Ctrl+S, Ctrl+Q con confirmación, Ctrl+F/F3, Ctrl+G, Ctrl+Z/Y); solo lectura si la cuenta no puede escribir | `EditSpec.editor` admite `msedit`; también a través de SSH |
| 18.4 | Documentación es/en (Terminal Windows), README, ayuda `help`, pruebas | El prompt local pasa de `C:\>` a la carpeta actual |

**Estado:** completada (v0.10.0, 450 pruebas; e2e de edit en la Terminal Windows y lectura del archivo desde Linux).
Revisión ECC: sin críticos; corregidos los dos altos (move de una carpeta movía su contenido y podía perder archivos; dir
fallaba con un enlace roto) y los medios (. y .. solo al listar una carpeta entera; carpeta vacía; *.*; preguntas de rd /s,
del de carpeta o *.*, y de sobrescritura en copy y move, con /q y /y; copy sobre sí mismo; varios archivos sobre uno;
redirección con una sola palabra de destino, > nul, 2> y > sin nombre; echo.). edit sale también con Esc (algunos
navegadores se quedan Ctrl+Q) y solo guarda el archivo que abrió.

**v0.10.1:** la barra de teclas táctil de todas las terminales añade Inicio, Fin, RePág y AvPág (en los editores pasan
al programa; en la línea de órdenes mueven el cursor o desplazan la salida). En edit, el menú (File, Edit, View, Help)
funciona con F10 o Alt+letra y resalta la letra de acceso de cada menú y opción (`editors/msedit-menu.ts`). El tamaño
de los editores a pantalla completa se mide en su propia caja: en móvil la barra de teclas ya no tapa sus últimas filas
(la barra de estado de edit y los atajos de nano).
Revisión ECC: sin críticos ni altos; corregidos los medios (Alt+letra por la tecla física, para que Option en Mac
funcione, y Cmd se deja al navegador; la ayuda de teclas cabe en la barra) y los bajos (el menú se recorta en pantallas
estrechas; F10 va junto a Esc en la barra táctil; las pistas de la barra de estado caben enteras).

**Modelos por fase (ECC):** regla propia en `.claude/rules/project/model-selection.md`, resumida en `CLAUDE.md`. opus
para planificar, implementar lo que cruza módulos, seguridad y diseño visual; sonnet para tareas acotadas, revisión y
salida IOS; haiku para búsquedas, textos y resúmenes. `security-reviewer` pasa a opus (los demás agentes ya tenían su
modelo: `planner` opus, el resto sonnet).

**v0.10.2 (corrección):** el dominio de DHCP (opción 15, `domain-name` del pool) no se usaba al resolver: un PC del
laboratorio «DNS de empresa» no completaba `www` a `www.empresa.lan`, y `hostname -f` inventaba `.localdomain`. Ahora
`/etc/resolv.conf` lleva `search <dominio>`, y la resolución del host (ping, nslookup, host, curl, ssh, navegador,
correo, traceroute, nmap y la Terminal Windows) sigue glibc con ndots:1; `dig` solo con `+search`, como el real.
`hostname -f` devuelve el nombre canónico de `/etc/hosts`. Pruebas en `tests/shells/dns-search.test.ts`.
Revisión ECC: sin críticos ni altos; corregidos los medios (una dirección IP o un nombre inverso no se buscan con el
dominio, para no dar respuestas falsas con comodines; REFUSED y los tiempos agotados terminan la búsqueda; sin respuesta,
se informa NODATA antes que un NXDOMAIN posterior) y añadidas pruebas de IP estática, concesión liberada y direcciones.

**v0.10.3:** `/etc/hosts` pasa a ser un archivo normal (root lo edita, se guarda con la topología) y la resolución del
equipo lo consulta antes que el DNS (nsswitch `files dns`: ping, ssh, curl, navegador, correo, Terminal Windows; nslookup,
host y dig siguen preguntando solo al servidor). `hostname -f` sale de él. netplan admite `nameservers.search` (hasta 6
dominios validados, también con dhcp4) para dar dominio de búsqueda a un equipo con IP estática; se guarda en el archivo
de topología (`search`) y aparece en `/etc/resolv.conf` y en el netplan generado.
Revisión ECC: sin críticos ni altos; corregidos los medios (leer /etc/hosts no construye ni refresca el sistema Linux
del equipo: `peekHostFile`, con el contenido por defecto si aún no existe; la lista de búsqueda de un archivo se acota
antes de validarla; se documenta que la Terminal Windows usa el mismo /etc/hosts) y un bajo (nombres con punto final en
/etc/hosts).

**Licencias (doble licencia):** el autor licencia también Netfix con términos privativos en Netfix Classroom
(repositorio privado `glopezca/netfix-classroom`). Para conservar esa posibilidad, `CONTRIBUTING.md` exige cesión de
derechos (CLA) a quien aporte código, y `LICENSE.md` lo explica en «Otras licencias y aportaciones».

## Fase 19 · Ganchos para Netfix Classroom: restricciones, modo incrustado y corrección sin interfaz (v0.11.0)

Fase 2 del plan de Netfix Classroom; todo es genérico y público (GPL), sin nada propio del aula. Referencia de uso en
`docs/EMBED.md`.

- **Restricciones** (`src/classroom/restrictions.ts`): JSON no fiable validado estrictamente (campos y valores conocidos,
  listas acotadas); lo que no se indica queda permitido. Laboratorios, equipos de la paleta, pestañas por tipo de equipo
  (la primera pestaña del equipo nunca se quita), documentación, Nuevo/Abrir/Guardar, modo simulación, adelantar el
  reloj, dibujo y edición de la topología (sin colocar, cablear ni borrar equipos o cables).
- **Modo incrustado** (`src/classroom/embed.ts`): con `<div id="app" data-embed>` Netfix no arranca solo; la página llama a
  `netfix.embed(elemento, { topology, restrictions, onChange })`. No guarda nada en el navegador: cada cambio llega a
  `onChange` con el archivo de topología, y el objeto devuelto ofrece `exportTopology()` y `destroy()`. `globalThis.netfix`
  es de solo lectura.
- **Corrección sin interfaz** (`src/classroom/checklist.ts`, `evaluate.ts`): lista de comprobación validada (hasta 200
  elementos con id único y peso 0-100) con comprobaciones `device`, `link`, `ip`, `ping`, `dns`, `http`, `file` y
  `config` (líneas literales de la configuración IOS, sin expresiones regulares). `evaluate(archivo, lista)` carga la
  topología (asienta 30 s simulados) y ejecuta cada comprobación dentro de la simulación; ninguna lanza excepción:
  falla con un motivo. También como `netfix.evaluate` en el navegador.
- **CPU** (`npm run bench:evaluate`, mediana de 5): cargar y corregir cada laboratorio con todas las comprobaciones lleva
  1-45 ms en Node 22 (el mayor, «VPN WireGuard»: 10 equipos, 41 comprobaciones). No cabe en los 10 ms del plan gratuito
  de Workers; sí, con holgura, en el de pago (30 s por defecto). Un archivo con bucles entre switches se rechaza por el
  límite de cálculo (50 000 tareas) en menos de 1 s.
- **Motor de eventos:** la cola es un montículo binario (`src/net/task-queue.ts`, antes inserción ordenada lineal), los
  cables se buscan por puerto en un `Map`, el historial de simulación se recorta por lotes (recortar de uno en uno
  copiaba 5000 eventos por trama), más de 20 000 tramas en vuelo se descartan (congestión) y `withWorkLimit` acota el
  trabajo total. Un bucle entre switches sigue saturando la red, como sin STP; el árbol de expansión queda pendiente.
- **Archivos de topología:** etiquetas de hasta 64 caracteres, configuración IOS (`config`, `startup`) de hasta 20 000
  líneas de 4096 caracteres; `startup` se valida. Un `/etc/hosts` guardado se usa desde la carga (antes, solo después
  de abrir la terminal del equipo).
- **Revisión ECC** (seguridad en opus, código en sonnet): corregido el crítico (un bucle entre switches colgaba la
  corrección y la pestaña: límite de cálculo y motor más rápido), los altos (`dns` aprobaba por /etc/hosts; la nota
  dependía del orden: archivos guardados aplicados desde la carga y comprobaciones pasivas primero) y los medios
  (`ping` con `expect: fail` aprobaba sin dirección; `config` sin contexto: `section`; dibujos editables con `drawing:
  false`; errores en `onChange`; idioma guardado en modo incrustado; límites del archivo) y bajos (etiquetas ambiguas,
  `title` sin caracteres de control, instalación de la API con `Object.hasOwn`, montaje validado). Documentado en
  `docs/EMBED.md` que las restricciones son de interfaz y la nota válida es la del servidor.
- Pruebas: `tests/classroom/*.test.ts` y `scripts/e2e-embed.mjs` (incluido en `npm run e2e`).

**v0.11.1 (Classroom, fase 4):** la revisión de seguridad de Classroom midió que cargar una topología pequeña podía
costar segundos: un router con 1000 interfaces tardaba 2,3 s (las interfaces se reordenaban en cada cambio; ahora se
insertan en orden: 0,2 s) y 500 servidores, 4,6 s y 160 MB. `src/classroom/budget.ts` rechaza antes de cargar más de
60 equipos o 6000 líneas de configuración IOS (`evaluate` lo aplica). Los textos de la lista de comprobación no admiten
caracteres de formato (dirección, ancho cero) y un error interno al cargar ya no se describe al llamante.


## Fase 20 · DNS por modos de funcionamiento, zonas guiadas y casilla «Activar router» (v0.12.0)

Mejora pedagógica pedida para Server y router Linux. Interpretación de la petición: la casilla «Activar router» está
**marcada** cuando `net.ipv4.ip_forward = 1` y desmarcada cuando vale 0 (el texto original repetía «desactivada»).

1. **Casilla «Activar router»** (solo router Linux). Pestaña Servicios → Parámetros: casilla de solo lectura, ligada a
   `net.ipv4.ip_forward`, con una etiqueta que explica que refleja ese parámetro y que se cambia en la tabla (o con
   `sysctl`). Gestión web (Seguridad → Enrutamiento): la misma casilla, aquí sí editable (guarda `ip_forward` como el
   formulario sysctl).
2. **Modelo de zonas** (`DnsSettings.zones`): cada zona tiene nombre, SOA (servidor primario, correo del responsable,
   serie, refresh, retry, expire, TTL negativo), lista de NS, tipo `forward` (por defecto) o `reverse` y registros.
   Zona directa: A, CNAME, MX, NS (delegación) y TXT; zona inversa (`*.in-addr.arpa`): solo PTR. Orden obligatorio en la
   interfaz: SOA → NS → tipo → registros (no se pueden añadir registros a una zona que no existe).
   - **Zonas inversas automáticas:** cada zona directa genera, por cada red /24 de sus registros A, la zona
     `c.b.a.in-addr.arpa` con sus PTR (mismo SOA y NS). Se listan como «automáticas», no se editan y aparecen en
     `named.conf.local` y en `/etc/bind/db.*`. Si el usuario crea a mano una zona inversa con ese nombre, manda la suya.
   - **Compatibilidad:** los archivos con `origin` + `records` (≤ 0.11) se convierten al cargar en una zona directa (los
     registros fuera del origen, en zonas por su dominio padre, como hacía `zonesOf`); los NS del ápice pasan a la lista
     NS y, si no había, se usa `ns.<zona>`.
   - Avisos de coherencia como `named-checkzone`: NS dentro de la zona sin registro A, zona inversa con nombre que no
     termina en `in-addr.arpa`, CNAME con otros datos.
3. **Modos de funcionamiento** (en este orden en todas las interfaces):
   - **Caché**: `max-cache-ttl` (0 = no guarda nada), contenido de la caché con su TTL restante y `rndc flush`.
   - **Agente de reenvío**: `forwarders { … }` y `forward only|first`.
   - **Autoritativo**: sirve las zonas (`named.conf.local`); apagado, las zonas se conservan pero no se cargan.
   - **Recursivo** e **Iterativo** van en este orden porque el iterativo depende del recursivo.
   - **Iterativo**: lo que hace BIND cuando recurre sin `forward only`: pregunta desde los servidores raíz
     (`/usr/share/dns/root.hints`) bajando por TLD y servidores autoritativos. No es una opción de BIND: se deriva
     (recursión activa y, si hay reenviadores, `forward first`); con reenviadores la casilla cambia `forward first/only`.
   - **Recursivo**: `recursion yes|no` y `allow-recursion { localnets; localhost; } | { any; }`. Por defecto, no
     (como hasta ahora: un servidor nuevo solo es autoritativo).
   - Internet emulada: servidores raíz (las 13 direcciones IPv4 reales), servidores de TLD (com, net, org, es, me,
     google, arpa y uno genérico para los dominios registrados en las nubes) y servidores autoritativos de las zonas
     incorporadas. Los dominios registrados en una nube con servidor propio se delegan a ese servidor, así que la
     iteración llega al servidor DNS del alumno. Cada salto es un paquete visible en el modo simulación.
4. **Coherencia GUI ↔ BIND**: `named.conf.options` (recursión, reenvío, caché) se puede editar como root y vuelve a la
   interfaz; `named.conf.local`, `named.conf.default-zones` (sugerencias raíz) y los archivos de zona siguen al panel.
   Prueba de ida y vuelta: lo que muestra el panel = lo que dice el archivo = lo que responde el servidor.
5. **Gestión web** con aspecto nuevo (barra lateral, tarjetas, avisos), común a Server y router Linux. Página DNS como la
   imagen de referencia: tarjetas de modo (Caché, Agente de reenvío, Autoritativo, Recursivo, Iterativo) con interruptor, descripción y usos; pestañas de
   configuración por modo; configuración BIND generada y explicada al lado.
6. Documentación es/en (servicio DNS, modos, zonas automáticas, casilla «Activar router»).

## Fase 21 · Prompt con marca de fecha y hora (v0.13.0)

Casilla «Prompt con marca de fecha y hora» al pie de las terminales Linux y Windows de PC, Server y router Linux.
Es un ajuste **del equipo** (lo comparten sus dos terminales y se guarda con la topología); útil para que las capturas
de una práctica o un examen lleven la fecha y la hora simuladas.

- **Terminal Linux:** como si se ejecutara `PS1="\[\e[32m\]\d \[\e[36m\]\A \[\e[33m\]\u@\h:\w\$ \[\e[0m\]"` en la
  sesión (también en las sesiones nuevas del equipo, incluidas las que abre SSH). Al desmarcarla vuelve el PS1 que había.
  Un `bash` o `su` anidado lee su `.bashrc`, como en Ubuntu.
- **Terminal Windows:** el prompt que daría en PowerShell la función `prompt` del enunciado: fecha `ddd MMM dd` y hora
  `HH:mm:ss` (DarkCyan), `usuario@equipo` (Green), ruta (Yellow) y `$` (o `#` para el administrador).
- **Bloqueo para Netfix Classroom:** restricción `timestampPrompt`: `"free"` (por defecto), `"on"` u `"off"`. Con
  `"on"`/`"off"` la casilla queda fija y desactivada («bloqueado por el profesor») y el valor se aplica a todos los
  equipos y a las sesiones SSH. El control de bloqueo del profesor en Classroom queda para su despliegue.

## Fase 22 · Interfaces de escucha, ficheros de configuración, SSH primero y cambios automáticos (v0.14.0)

1. **Interfaces de escucha de DNS y DHCP** (Server: eth0; router Linux: eth0-eth2), como Kea y BIND:
   - DHCP: `dhcp.interfaces` (nombres Linux; sin valor = todas). Kea: `"interfaces-config": { "interfaces": [ "eth1" ] }`
     o `[ "*" ]`. Una petición que llega por otra interfaz se descarta (también la de un relay, que entra por la
     interfaz que tiene la dirección del servidor).
   - DNS: `dns.listenOn` (interfaces y `lo`; sin valor = todas). BIND: `listen-on { 127.0.0.1; 192.168.1.1; };` o
     `{ any; };` (por direcciones, que se derivan de las interfaces). Una consulta a una dirección en la que no escucha
     no tiene respuesta (puerto cerrado). Editar `listen-on` en named.conf.options vuelve al panel.
   - Bloque «Interfaces» en los paneles DHCP y DNS y en las páginas DHCP y DNS de la gestión web; botón «Aplicar»
     (reinicia el servicio, como systemctl restart).
2. **Ficheros de configuración:** apartado «Ficheros» en Servicios (como «Registros»): se elige el servicio y se ven
   sus ficheros tal como están ahora en el disco (SSH, DHCP, DNS, HTTP, Correo y, en el router, Parámetros, Firewall y
   VPN: los mismos apartados que su pestaña Servicios). También en la gestión web (Estado → Ficheros). Solo en Linux.
3. **SSH primero** entre los servicios (Server: SSH, DHCP, DNS, HTTP, Correo, Registros, Ficheros; en el router Linux,
   tras Parámetros, Firewall y VPN). En la gestión web, SSH es la primera página de Servicios.
4. **Cambios automáticos en las ventanas de los equipos** (sin botón Guardar):
   - PC, Server y router Linux: el nombre del equipo se aplica al cambiar el campo y el nombre de host se deriva de él
     (minúsculas, sin tildes, guiones). El nombre de host queda como dato de solo lectura (hostnamectl lo sigue
     cambiando) y desaparecen los botones «Guardar» y «Usar el nombre visible».
     El diagrama muestra el nombre del equipo y su IP/prefijo (una línea por interfaz con dirección).
   - Nubes: datos del ISP y configuración de cada línea. Router Linux: dirección de cada interfaz. Equipos IOS: nombre
     visible y `hostname`.
   - Se mantienen: el «Aplicar» de los servicios (reiniciar el servicio), los formularios que generan órdenes IOS
     (interfaces y gestión web IOS: se ve la orden que se ejecuta), las acciones de listas (añadir dominio,
     redirección, ruta) y la cuenta de correo del PC (como en un cliente de correo).

**Estado:** completada (v0.14.0, 578 pruebas; e2e-v014). Revisión ECC: code-reviewer (sonnet) sin críticos ni altos;
corregidos los medios (dirección del router comparada con la viva, 127/8 que llega por la red se descarta como en
Linux, el clic que quita el foco ya no se pierde al aplicar, el hostname puesto con hostnamectl se conserva al renombrar,
`listen-on port 53 { … }` y una interfaz sin dirección no se pierden al guardar named.conf.options) y los bajos.
security-reviewer (opus): sin críticos, altos ni medios; corregidos los bajos (named.conf.options de más de 64 KiB se
rechaza y se analiza en tiempo lineal, «Ficheros» no sigue enlaces fuera del árbol del servicio, una lista vacía en un
archivo de topología se rechaza).

## Fase 23 · Broadcast IP y nombres públicos en el DNS (v0.15.0)

Estado de partida: el broadcast de enlace (ARP, DHCP) funciona, pero un ping a una dirección broadcast es falso: cada
equipo «responde» con la propia dirección broadcast como origen, sin mirar `icmp_echo_ignore_broadcasts`, solo cuenta
la primera respuesta y los routers reenvían siempre los broadcast dirigidos.

1. **Broadcast IP como en los equipos reales:**
   - Destinos: 255.255.255.255 (limitado, nunca se enruta) y la dirección broadcast de cada subred (dirigido). Un equipo
     recibe el broadcast dirigido de cualquiera de sus interfaces.
   - Quién responde a un eco a broadcast, con su propia dirección como origen: IOS (router y switch), sí; GNU/Linux
     (PC en modo Linux, Server, router Linux) según `net.ipv4.icmp_echo_ignore_broadcasts` (1 por defecto, como
     Ubuntu: no responde); Windows, nunca.
   - Reenvío de broadcast dirigido: desactivado por defecto. IOS `ip directed-broadcast` en la interfaz de salida
     (`no ip directed-broadcast` desde 12.0); router Linux `net.ipv4.conf.all.bc_forwarding` (0). Activado, el router
     lo entrega también como broadcast de enlace en esa red.
   - Ping: Linux exige `-b` («Do you want to ping broadcast? Then -b…»), avisa «WARNING: pinging broadcast address» y
     marca las respuestas repetidas con `(DUP!)` y `+N duplicates`; Windows muestra la primera respuesta de cada
     petición; IOS lista «Reply to request N from A.B.C.D, 1 ms» por cada equipo que responde.
   - El switch inunda el broadcast solo en su VLAN; ningún router lo pasa (comprobado con pruebas).
2. **Nombres públicos en el servidor DNS** (Server y router Linux), con un fichero editable:
   - Lista inicial en `src/net/public-names.ts`: los nombres que ya conoce la Internet emulada, google.es,
     educa.jcyl.es, juandecolonia.es y el top 100 mundial (Similarweb/Semrush, 2026), sin webs para adultos ni de
     apuestas (Netfix se usa con menores). Direcciones representativas de las reales.
   - En BIND: zona de política de respuesta (RPZ) con datos locales: `response-policy { zone "rpz.publicos"; };` en
     named.conf.options y `/etc/bind/db.rpz.publicos` con un `nombre A ip` por línea (admite `*.dominio`). Como en
     BIND, se aplica a las consultas recursivas: necesita el modo Recursivo.
   - Opción del servicio DNS «Nombres públicos (response-policy)»: activar, editar el fichero y restaurar la lista
     inicial; «Aplicar» reinicia bind9. En el panel y en la gestión web. Root puede editar el fichero.
   - La Internet emulada conoce los mismos nombres (8.8.8.8 y la jerarquía raíz → TLD → autoritativo) y cada dirección
     responde a ping y a HTTP, así que ping, nslookup y dig funcionan con o sin la opción si hay salida a Internet.

**Estado:** completada (v0.15.0, 596 pruebas; e2e-v015). Revisión ECC: security-reviewer (opus) sin críticos ni altos;
corregido el medio (un broadcast dirigido que ya llegó por su subred no se reenvía: evitaba tormentas entre routers
Linux con subredes solapadas) y los bajos (mensajes de error recortados y sin caracteres de control, TTL numérico en
el JSON, registros repetidos). code-reviewer (sonnet) sin críticos ni altos; corregidos los medios (el reenvío de
broadcast dirigido pasa por el camino normal: ACL de salida, IPsec y nftables; «Aplicar» con la lista inicial sin
cambios la deja implícita; `ping -bc 3`; nmap no cuenta la dirección broadcast como equipo) y parte de los bajos
(`endEcho` en finally, interfaces caídas). Pendiente: la salida de IOS cuando un ping a broadcast no tiene respuesta.

## Fase 24 · Nombre de host fijo, nubes como equipos y nombres de interfaz sobre el cable (v0.16.0)

1. **ping -b:** repaso con todos los emisores (PC Linux/Windows, Server, router Linux, IOS) y receptores, en tiempo
   real y en simulación. Como Linux, el emisor recibe también su propia copia del broadcast (el núcleo la devuelve por
   el bucle local), así que responde a sí mismo si `icmp_echo_ignore_broadcasts=0`.
2. **Nombre de host bloqueado** en PC, Server y router Linux: siempre `hostnameFromLabel(nombre del equipo)`, también
   al crear el equipo, al abrir una topología (se ignora un `hostname` guardado) y al deshacer. Lo rechazan
   `hostnamectl set-hostname` / `hostnamectl hostname`, `hostname NOMBRE`, `sysctl -w kernel.hostname=…`, escribir
   /etc/hostname y la gestión web (Configuración muestra el nombre sin campo). El nombre descriptivo (`--pretty`)
   sigue libre. Los laboratorios cuyo servidor tenía un nombre de host propio (srv, ns1) pasan a llamarse así.
3. **Nubes como los equipos:** pestaña «Equipo» con el nombre (se aplica al cambiarlo) y el nombre de host derivado
   de solo lectura; en el diagrama, el nombre de la nube y su bloque público (CIDR) en lugar del nombre del ISP, que
   sigue en la pestaña ISP.
4. **Nombres de interfaz sobre el cable:** cada etiqueta se dibuja centrada sobre su cable (con un halo del color del
   fondo), justo fuera del recuadro del equipo y de su pie (nombre e IP), en vez de al lado y por debajo del nombre.

**Estado:** completada (v0.16.0, 605 pruebas; e2e-v016 con comprobación geométrica de las etiquetas). Revisión ECC:
security-reviewer (opus) sin críticos, altos ni medios; aplicados los bajos (imports sobrantes, mensaje claro en
`sysctl kernel.hostname`, nombres de host repetidos). code-reviewer (sonnet) sin críticos ni altos; corregidos los
medios: la copia local del broadcast solo para el ping propio (un router Linux que reenvía no responde dos veces) y
nombres de host únicos (`-2`, `-3`… si dos nombres de equipo dan el mismo). Los servidores de los laboratorios de
sedes e intranet toman el nombre de su etiqueta (srv-sede2, srv-intranet); el de «servidores» se llama SRV (srv).

## Fase 25 · resolvectl en las terminales Linux (v0.17.0)

`resolvectl` (cliente de systemd-resolved, Ubuntu 26.04) en PC, Server y router Linux, con la salida literal de
systemd 257, sobre el resolutor que ya usan ping, dig, nslookup y host (/etc/hosts, lista de búsqueda, DNS del equipo):

- `resolvectl [status [ENLACE]]`: Global (protocolos, `resolv.conf mode: foreign`, porque /etc/resolv.conf lo escribe
  Netfix) y un bloque por enlace (`Link 2 (eth0)`: ámbito, +DefaultRoute, servidor DNS actual, servidores y dominios).
  Los enlaces sin DNS salen con `Current Scopes: none`.
- `resolvectl query [-t TIPO] [-4] [--legend=no] NOMBRE|IP…`: A (con CNAME), PTR de una IP y cualquier tipo con -t;
  `-- link: eth0`, tiempo en milisegundos simulados y `Data from: network` o `synthetic` (/etc/hosts, el propio
  nombre). Errores: `resolve call failed: 'x' not found`, `… does not have any RR of the requested type`, `All attempts
  to contact name servers or networks failed`, `No appropriate name servers or networks for name found`.
- `resolvectl dns [ENLACE [SERVIDOR…]]` y `resolvectl domain [ENLACE [DOMINIO…]]`: ver y, como root, cambiar en
  tiempo de ejecución el servidor DNS y los dominios de búsqueda del enlace principal (Netfix usa un servidor por
  equipo: con varios, el primero). `revert ENLACE` vuelve a la configuración de netplan; `flush-caches` y
  `reset-server-features` (sin caché local en Netfix: no hacen nada visible); `statistics` con las consultas que pasan por el
  resolutor del equipo; `-h`.
- Entrada en la documentación de órdenes (es/en) y en la pestaña Documentación.

**Estado:** completada (v0.17.0, 9 pruebas de resolvectl; e2e). Revisión ECC: security-reviewer (opus) sin críticos,
altos ni medios; aplicados los bajos (lo que se repite de los argumentos, recortado y sin caracteres de control;
dominios de hasta 253 caracteres; 64 nombres por consulta). code-reviewer (sonnet) sin críticos ni altos; corregidos
los medios: opciones antes del verbo y con valor (`-t MX query`, `-i eth0`, `--legend no`, opciones desconocidas), el
cambio de `resolvectl dns|domain` se compara por valor (una renovación DHCP o un `netplan apply` sin cambios no lo
quitan; un cambio real sí), datos sintéticos «authenticated: yes», «Too few arguments.», «Interactive authentication
required.», tiempos en us/ms/s, `dns eth0 ""` y `domain eth0 ""` vacían la lista, /etc/resolv.conf no refleja el
cambio temporal, AAAA/ANY… sin registros y estadísticas solo del resolutor (no `dig @servidor`).

## Fase 26 · Direcciones junto a su interfaz y laboratorios sin etiquetas solapadas (v0.18.0)

1. **Dirección bajo el nombre de su interfaz:** en cada extremo de cable, el nombre corto de la interfaz (Gig0/0) y
   debajo su IP/CIDR, sea de un PC, Server, router Linux, router IOS (incluida la DHCP y, si el puerto físico no tiene,
   las de sus subinterfaces) o de una línea de nube (la LAN del router del operador o la pasarela de la línea pública).
   El pie del equipo deja de listar direcciones: solo quedan las de interfaces sin cable (no tienen dónde ir), el
   hostname IOS distinto del nombre y el bloque público de una nube.
2. **Cálculo único de las etiquetas** (`src/ui/link-labels.ts`): posición y recuadro de cada etiqueta de extremo, que
   usan el lienzo y una prueba.
3. **Laboratorios sin solapes:** una prueba recorre todos los laboratorios y comprueba que ninguna etiqueta de interfaz
   se monta sobre otra, sobre el pie o el modelo de un equipo ni sobre el título de un área; se reajustan las
   posiciones (longitud de los cables) de los que fallen. El e2e repite la comprobación con el texto real.

**Estado:** completada (v0.18.0, 633 pruebas; e2e en todos los laboratorios). Revisión ECC (code-reviewer): sin
críticos ni altos; corregido el medio (en un cable demasiado corto para la dirección solo se dibuja el nombre de la
interfaz, y los dos extremos no se juntan) y los bajos: la dirección de una línea de nube sale de la propia nube
(`gatewayAddr`), la prueba de solapes deja 2 px de margen, y las direcciones IOS sin cable (SVI Vlan1, Loopback,
Tunnel) se ven bajo el equipo.


## Fase 27 · Áreas redimensionables, selección por retícula, copiar, pegar y duplicar (v0.19.0)

1. **Redimensionar áreas y dibujos:** un rectángulo o una elipse seleccionados muestran ocho tiradores (esquinas y
   puntos medios de los lados); arrastrar uno cambia el tamaño dejando fijo el lado opuesto (tamaño mínimo). Una línea
   muestra sus dos extremos. Función pura `resizeAnnotation` en `net/annotations.ts`; deshacer, como cualquier cambio
   de dibujos.
2. **Selección por retícula:** con «Seleccionar», arrastrar con el ratón sobre el fondo dibuja un rectángulo
   discontinuo; al soltar quedan seleccionados los equipos cuyo centro cae dentro y los dibujos que caben enteros
   (con Mayús se añaden a la selección). Mover la vista: botón central o derecho, Espacio + arrastrar, o el dedo en
   pantallas táctiles. Arrastrar un elemento seleccionado mueve todo el grupo; Supr lo borra entero; Escape lo
   deselecciona. Cada acción de grupo es un único paso de deshacer (nueva edición `group` del historial).
3. **Copiar, pegar y duplicar:** Ctrl+C, Ctrl+V y Ctrl+D (⌘ en Mac), y botones en la barra. Se copian los equipos con
   su configuración (running-config, IP, servicios, ficheros), los cables entre ellos y los dibujos seleccionados;
   al pegar, cada equipo recibe el siguiente nombre libre (y su nombre de host derivado), las nubes un bloque público
   libre, todo se desplaza 40 px por pegado y lo pegado queda seleccionado. Lógica en `net/topology-clip.ts`.

**Estado:** completada (v0.19.0, 641 pruebas; e2e-v019 con recuadro, arrastre y borrado de grupo, copiar, pegar,
duplicar, desplazamiento con el botón central y tiradores). Revisión ECC: code-reviewer (sonnet) sin críticos ni altos;
corregidos los pegados fuera del área, copiar con la topología bloqueada, ids borrados por otra vía en la selección,
recuadro cancelado y el id del equipo arrastrado. security-reviewer (opus) sin críticos ni altos; corregido el límite de
cables al pegar (mismo que al abrir un archivo, para que lo guardado se pueda abrir). Los routers y switches pegados
conservan su `hostname` de IOS, como en Packet Tracer.

## Fase 28 · Selección por recuadro en pantallas táctiles (v0.19.1)

**Diagnóstico.** En pantallas táctiles, arrastrar el fondo solo desplaza la vista, así que no había forma de dibujar
el recuadro. Tampoco se podía borrar un grupo, porque no hay tecla Supr. Y el doble toque sobre un equipo de un grupo
no lo abría.

**Cambios:**

- **Recuadro.** Con dedo o lápiz, un arrastre rápido sigue desplazando la vista. Mantener el fondo pulsado 450 ms, sin
  moverse más de 10 px, para el desplazamiento, vibra si el dispositivo puede y empieza el recuadro. Ese recuadro añade
  a la selección, como Mayús con el ratón. Si entra un segundo dedo (pellizco), no se activa.
- **Quitar la selección.** Un toque corto en el fondo la quita.
- **Abrir un equipo del grupo.** Un toque sin arrastre sobre un elemento del grupo cuenta como toque, así que el doble
  toque abre el equipo.
- **Borrar.** Botón 🗑 «Borrar la selección» en la barra, junto a copiar, pegar y duplicar. Borra el grupo o, si no
  hay grupo, el elemento seleccionado; Supr hace lo mismo con teclado.
- **Código.** `Viewport.beginPan` devuelve una función para parar el desplazamiento. `Canvas.deleteSingle` reúne el
  borrado individual.

**Pruebas.** `scripts/e2e-touch.mjs` usa eventos táctiles reales a través de CDP y comprueba que:

- un arrastre rápido desplaza la vista y no selecciona;
- una pulsación larga seguida de arrastre selecciona;
- arrastrar el grupo con un dedo lo mueve y se deshace en un paso;
- el doble toque abre un equipo del grupo;
- un toque en el fondo quita la selección;
- el botón 🗑 borra el grupo y se deshace.

**Revisión ECC (code-reviewer, sonnet).** No hay fallos críticos ni altos. Se corrigieron dos:

- **Pellizco.** Un toque o pellizco con dos dedos ya no quita la selección: cualquier otro dedo en el fondo marca el
  gesto como zoom.
- **Elemento suelto.** El recuadro de la pulsación larga (y el de Mayús con el ratón) conserva el elemento que estaba
  seleccionado por separado, que antes se perdía con el clic en el fondo.

Ambos casos tienen su prueba en `e2e-touch`.

## Fase 29 · «Configuración» con la sintaxis resaltada como en vim (v0.19.2)

**Nombre y orden.** El apartado «Ficheros» de servidores y routers Linux pasa a llamarse **Configuración** y queda
antes de Registros, tanto en la pestaña Servicios como en Estado de la gestión web.

**Resaltado** (`src/editors/vim-syntax.ts`, puro). El tipo de archivo se deduce de la ruta, como hace `filetype.vim`:

| Tipo de archivo | Archivos |
|---|---|
| `sshdconfig` | `sshd_config` y `sshd_config.d/` |
| `json` | Kea |
| `named` | `named.conf*` |
| `bindzone` | zonas de `/etc/bind` |
| `apache` | configuración de Apache |
| `pfmain` | `main.cf` de Postfix |
| `dovecot` | configuración de Dovecot |
| `sysctl` | `sysctl.conf` y `sysctl.d/` |
| `nftables` | `nftables.conf` y `*.nft` |
| `dosini` | WireGuard |
| `conf` | el resto |

- **Grupos.** Cada tipo tiene un juego pequeño de reglas que asigna los grupos de vim: Comment, Constant, String,
  Number, Identifier, Statement, PreProc, Type y Special. Los comentarios `/* */` pueden ocupar varias líneas.
- **Exploración del texto.** Se recorre palabra a palabra, para que ninguna regla encaje dentro de una palabra, y en
  tiempo lineal (prueba con una línea de 256 KiB).
- **Colores.** Los del esquema `default` de vim: con `background=dark` en la ventana del equipo (Statement amarillo,
  Comment azul claro, Constant rosa, Type verde, PreProc magenta, Identifier cian, Special naranja) y con
  `background=light` en la página web de gestión, que tiene fondo claro.
- **Seguridad.** Los fragmentos se insertan con `textContent` (interfaz) o con `h()`, que escapa el texto (web): el
  contenido de un fichero nunca se interpreta como HTML.

**Pruebas:**

- `tests/editors/vim-syntax.test.ts`, con 7 pruebas: tipos de archivo, que no se pierde ningún carácter, cada sintaxis
  y el tiempo lineal.
- `tests/web/admin-listen.test.ts`: el orden de las pestañas, los grupos en el HTML y el escapado.
- `e2e-v014`: el orden del menú y los colores calculados en el navegador.

**Revisión ECC (code-reviewer, sonnet).** No hay fallos críticos. Se corrigieron estos:

- **Alto: retroceso cuadrático.** Una línea hostil en Dovecot o en una zona podía tardar segundos. Se resuelve con
  grupos atómicos, `(?=(…))\1`, y con `SYNMAXCOL` = 1000: como el `synmaxcol` de vim, a partir de esa columna el texto
  va sin resaltar. Hay prueba con líneas de 200 000 caracteres.
- **Bajo: tipos de registro.** Un nombre que empieza por un tipo de registro (`NS.aula.lab.`) ya no se colorea como
  tipo.

## Fase 30 · Marcas: viñetas con el diamante y la N en el pie de la WebGUI (v0.19.3)

- **Viñetas de la documentación.** En lugar del isotipo secundario (la X de cuatro nodos), llevan solo el cuadro hueco
  en diamante que hay en el centro de cada letra del logo. Es `assets/brand/diamond.svg`, vectorial, con el rojo del
  logo (#f60212) y las proporciones medidas en el isotipo: cuadrado redondeado girado 45° con el hueco centrado. Pasa a
  `BRAND.diamond` (`npm run brand`) y a la variable CSS `--brand-diamond`.
- **Pie de la WebGUI de servidores y routers Linux.** El crédito lleva el isotipo primario, la N (clase
  `web-brand-n`, 20 px). Las páginas de IOS y Roundcube conservan su marca.
- **Pruebas.** `e2e-brand` comprueba con estilos calculados que la viñeta es el SVG y que el pie lleva la N, y guarda
  capturas para revisarlas. `admin-listen` comprueba el marcado del pie.

## Fase 31 · Hostname de IOS derivado del nombre del equipo; la N en todas las WebGUI (v0.19.4)

**Marcas.** El pie de la WebGUI de los equipos IOS y el de Roundcube también llevan el isotipo de la N.

**Regla de los equipos Linux aplicada a IOS:** el `hostname` sale siempre del nombre del equipo.

- **Cómo se deriva** (`iosHostnameFromLabel`). Se conservan las mayúsculas; acentos y ñ pasan a letras simples; el
  resto de caracteres, a guiones. Si no empieza por letra, se antepone «Router-» o «Switch-». Como mucho 63 caracteres.
  Si dos nombres dan el mismo hostname entre equipos IOS (sin distinguir mayúsculas), el segundo recibe -2.
- **En la CLI** (y en la configuración desde la gestión web): `hostname` con otro nombre, o `no hostname`, responde
  `% In Netfix the hostname comes from the device name (Device tab)`. El mismo nombre se acepta.
- **Configuración repetida** (`applyConfig`: archivos, laboratorios, configuración pegada). Su línea `hostname` se
  ignora en silencio. `write erase` y `reload` mantienen el nombre derivado.
- **Fuera de un área de trabajo** (pruebas de la CLI, corrector), `hostname` funciona como en IOS.
- **Pestaña Equipo.** El hostname es de solo lectura; cambiar el nombre lo cambia.
- **Rótulo del diagrama.** Ya no repite el hostname, que es el propio nombre.
- **Archivos anteriores.** Un archivo de una versión anterior cuyo `hostname` se puso desde la CLI (por ejemplo
  «Router0» con `hostname GW`) se abre con ese hostname como nombre del equipo (`savedLabel`). Así el trabajo del
  alumno conserva su prompt; el valor por defecto `Router`/`Switch` no cuenta.
- **Laboratorios.** Los equipos se llaman como su hostname: GW, DHCP-SRV, EDGE, SW-ACCESO, SW, ROGUE, ISP y CPE. Las
  zonas siguen esos nombres, y básico, reservas y snooping se estiran un 20 % en vertical para que ninguna etiqueta
  tape el nombre de una zona.
- **Pruebas.** `tests/net/ios-names.test.ts` cubre la derivación, el renombrado, la CLI, la recarga, los archivos
  antiguos, el equipo fuera del área de trabajo y los laboratorios. Las demás pruebas que contaban con el
  comportamiento anterior se han adaptado.

**Revisión ECC (code-reviewer, sonnet).** Se corrigieron dos fallos medios:

- **Nombres repetidos al migrar.** Dos routers con `hostname R1`, o un hostname igual al nombre de otro equipo, ya no
  dan nombres repetidos: el segundo conserva su nombre.
- **Hostname repetido tras deshacer.** `restorePlaced` vuelve a derivar siempre el nombre, así que deshacer un borrado
  no deja dos equipos con el mismo hostname.

**Aviso alto, aceptado y anotado.** Las comprobaciones del aula se buscan por el nombre del equipo, y los laboratorios
han pasado de «Router0» a «GW» (y equivalentes). Al actualizar el submódulo en FixIT Classroom hay que revisar las
listas de comprobación que nombren «Router0», «Router1» o «Switch» de laboratorios antiguos.

**Aviso bajo.** Un hostname antiguo con caracteres que IOS no admite aquí (como `R_1`) pasa a `R-1`.

## Fase 32 · Orden de Registros (v0.19.5)

En Servicios → Registros de servidores y routers Linux, el desplegable de unidades va en este orden:

1. `ssh`.
2. `nftables`, solo en los routers Linux.
3. El resto en su orden habitual: `kea-dhcp4-server`, `bind9`, `apache2`, `postfix` y `dovecot`.

El orden lo da `logUnits(kind)` en `src/services/units.ts`, una función pura. `UNITS` no cambia, porque también la
usan `systemctl` y la gestión web. La página «Registros» de la gestión web muestra todas las unidades juntas, sin
selector.

Pruebas: `tests/services/log-units.test.ts` y `e2e-v014`, que recorre las opciones del desplegable en un Server y en un
router Linux.

## Fase 33 · Orden de la WebGUI y registros resaltados como en vim (v0.19.6)

- **Menú de Seguridad de la WebGUI del router Linux.** Ahora va Enrutamiento, Firewall, VPN (antes, Firewall primero).
- **DNS en la WebGUI de servidores y routers Linux.** «Interfaces de escucha» va antes de «Modo de funcionamiento del
  servidor».
- **Registros resaltados.** Se resaltan como vim muestra los logs, con el tipo de archivo `messages` de vim (syslog y
  journalctl):

  | Parte | Grupo de vim |
  |---|---|
  | Fecha | Constant |
  | Hora | Type |
  | Equipo | Identifier |
  | Programa | Statement |
  | `[PID]` | Constant |
  | Direcciones IPv4 | Constant |
  | Línea con `error`, `failed`, `failure` o `fatal` | Error (ErrorMsg: blanco sobre rojo) |

  Funciona en la pestaña Registros de la ventana del equipo y en la página Registros de la gestión web, con el formato
  `HH:MM:SS unidad: texto`. Los registros se ajustan a la anchura, como hace vim por defecto.
- **Código.** Hay ayudantes compartidos: `src/ui/syntax-view.ts` (`fillSyntax` y `syntaxView`, con `textContent`) y
  `src/web/syntax-html.ts` (`syntaxPre`, escapado por `h()`). Los ficheros de configuración de la gestión web ya se
  resaltaban desde la fase 29.
- **Rendimiento.** Las búsquedas hacia atrás están ancladas al principio de la línea. Hay pruebas con líneas hostiles
  de `messages`.
- **Pruebas.** Las de `vim-syntax`, `admin-listen` (orden, escapado y grupos) y `e2e-v014` (colores calculados en el
  navegador).

**Revisión ECC (code-reviewer, sonnet).** Aprobado, sin fallos altos. Comprobó el escapado y el rendimiento: con 200
líneas hostiles de 1 000 caracteres tarda menos de 100 ms. Quedan tres avisos bajos, aceptados porque así se comporta
vim o porque no tienen efecto visible:

- **Error demasiado amplio.** Una línea que contiene «error» se pone en rojo aunque sea un nombre de usuario. vim hace
  lo mismo con `messagesError`.
- **`(?<=: )`.** Encaja con cualquier `: ` de la línea, no solo con el que sigue al programa.
- **Reglas duplicadas.** Las reglas globales de `.syn-error` coinciden con las de la gestión web.

## Fase 34 · Resaltado visible en la WebGUI, icono de Configuración y orden de HTTP (v0.19.7)

- **Fallo corregido.** En la WebGUI no se veía el resaltado: el navegador simulado (`ui/html-render.ts`) solo conserva
  las clases `web-*` y descartaba las `syn-*` y `data-filetype`, así que el texto quedaba negro. Ahora las páginas web
  usan `web-syn-<grupo>` y `web-syn-<tipo de archivo>`, con los colores de vim para `background=light` en
  `web-admin.css`. La ventana del equipo sigue con `syn-*` y fondo oscuro, así que las dos no se mezclan.
- **Por qué no se detectó.** Las pruebas unitarias miraban el HTML generado, no lo que pinta el navegador. El nuevo
  `e2e-webgui` abre la WebGUI desde el navegador de un PC y comprueba los colores calculados de Statement, Comment,
  Constant y Type.
- **Icono.** «Configuración» lleva 🔧 en el menú Estado de la WebGUI.
- **Descripción.** Se añadió la que le faltaba (`wa.desc.files`). Hay una prueba que exige descripción en los dos
  idiomas para todas las páginas.
- **Orden en Servicios → HTTP de servidores y routers Linux.** «Gestión web del servidor» va antes de Roundcube, también
  en la línea de estado.

## Fase 35 · Llave inglesa monocroma en el menú de la WebGUI (v0.19.8)

- **Icono.** El emoji 🔧 se veía en color y con otro tamaño que el resto de iconos del menú, que son glifos de texto.
  Se sustituye por una llave inglesa propia: una silueta SVG con la boca recortada, usada como máscara CSS y pintada
  con `currentColor`. Queda monocroma, toma el color del texto del menú (gris, o blanco en la entrada activa) y ocupa
  18 × 15 px, como los demás glifos.
- **Pruebas.** `e2e-webgui` comprueba que la máscara existe, que se pinta con el color del texto y que tiene la anchura
  de los otros iconos, y guarda una captura del menú.

## Fase 36 · Documentación reordenada, jerárquica, visual y guiada para ASIR (v0.20.0, por fases)

**Decisiones del propietario (24/10/2026).**

- **Recursos visuales.** Diagramas generados en código, que se actualizan con la app:
  - minitopologías con los iconos de la paleta;
  - diagramas de secuencia (DORA, DNS…);
  - terminales con resaltado vim;
  - pasos numerados;
  - avisos, comprobaciones y ejercicios.
- **Estilo guiado para ASIR.** Cada página sigue el mismo guion: qué es y para qué sirve, cómo se hace en Netfix paso a
  paso, cómo se comprueba, errores típicos y un ejercicio corto con la solución desplegable.
- **Entrega por fases**, publicando cada una para revisión.

**Estructura.** Un grupo por equipo, en el orden de la paleta: PC, Servidor, Switch IOS, Router IOS, Router Linux y
Nube ISP. Dentro de cada equipo, sus servicios van en el orden de su ventana. El Servidor sigue este orden: general,
SSH, DHCP, DNS, HTTP (Apache, gestión web, Roundcube), correo y Configuración y registros. Antes de los equipos va el
grupo Netfix; después, Conceptos de red, Terminal Linux y GNU bash.

**Navegación.** Grupos plegables con el icono del equipo, secciones con sangría y línea guía, la página actual
resaltada y una ruta «Grupo › Sección» encima del título.

**Fases:**

| Fase | Contenido |
|---|---|
| 36a | Estructura y navegación, componentes visuales (bloques `steps`, `callout`, `figure` y `term`), la página nueva «Configuración y registros» y una página modelo reescrita (Servidor → DHCP) para validar el estilo |
| 36b | PC y Servidor |
| 36c | Switch IOS, Router IOS, Router Linux y Nube |
| 36d | Netfix, Conceptos de red, Terminal Linux y bash |

Las pruebas de paridad es/en cubren los bloques nuevos.

### Notas de la fase 36a (v0.20.0)

**Hecho:**

- **Estructura.** `src/docs/outline.ts` y su gemelo `en/outline.ts` definen los grupos y las secciones;
  `src/docs/arrange.ts` coloca en ellos las páginas de cada módulo. Una prueba exige que cada página aparezca una sola
  vez, que los equipos sigan el orden de la paleta y que el Servidor siga el orden de su pestaña Servicios.
- **Navegación.** Los grupos se pliegan y llevan el icono de la paleta (Netfix lleva su N). Las secciones van en
  versalitas con línea guía y sangría, y cada grupo muestra cuántas páginas tiene. Al abrir una página se despliega su
  grupo. Encima del título va la ruta «Grupo › Sección».
- **Bloques nuevos** (`types.ts`), con su paridad comprobada en `docs-en`:

  | Bloque | Qué muestra | Dónde se dibuja |
  |---|---|---|
  | `steps` | Pasos numerados con línea de progreso | — |
  | `callout` | Consejo, error típico, compruébalo o ejercicio con la solución plegada | — |
  | `figure` | Topología con los iconos de la paleta y etiquetas con halo, o diagrama de secuencia; a su tamaño, sin agrandarse | `doc-figures.ts` |
  | `term` | Terminal de shell, IOS o cmd con prompt y orden destacados, o un fichero en colores de vim | `doc-term.ts` |

  Además, el Markdown en línea funciona en las páginas con `markdownBase`.
- **Páginas.** Una nueva, «Configuración y registros». Una página modelo reescrita, Servidor → DHCP, con este guion:
  qué es, topología, DORA, pasos, campos, reservas, fichero de Kea, compruébalo, errores típicos y ejercicio. Las
  salidas de ejemplo están sacadas del simulador.
- **WebGUI.** «Equipo» tiene ahora un monitor monocromo, con el mismo sistema que la llave.
- **Pruebas.** `e2e-docs` comprueba el orden, los iconos, las secciones, la ruta, los diagramas, los pasos, las
  terminales y el ejercicio, y guarda capturas para revisarlas.

**Siguiente:** fase 36b, reescribir con el mismo guion el resto de PC y Servidor.

### Correcciones del propietario antes de la fase 36b (v0.20.1)

1. **«Dirección IP».** Cuando se habla de una dirección, y no del protocolo IP, se dice siempre «dirección IP»: «Rellena
   **Dirección IP inicial**». En inglés, «IP address».
   - **Dónde.** Se revisaron a mano la documentación y la interfaz en los dos idiomas (DHCP, nube ISP, cortafuegos,
     PDU, gestión web, reservas, correo y SSH).
   - **Qué no cambia.** Lo que nombra el protocolo o una pestaña («Configuración IP», «a nivel IP», «plano IP») y los
     marcadores de sintaxis (`http://IP`, `IP:PUERTO`, `usuario@IP`).
   - **Regla para las fases siguientes.** Se mantiene en todo texto nuevo.
2. **Midnight Commander.** Tiene página propia (`mc`), en una sección justo antes de los editores nano y vim. La página
   incluye:
   - una pantalla real generada con el `McApp` de Netfix;
   - cómo abrirlo, incluido `sudo mc`, comprobado;
   - la tabla de teclas y el truco Esc + número;
   - copiar paso a paso, compruébalo, errores típicos y un ejercicio que publica un directorio en Apache, comprobado
     con el listado de Apache.


### Notas de la fase 36b (v0.20.2)

- **PC.** Configuración IP, Nombre del equipo, Navegador y correo, y Terminal Windows, reescritas con el guion de 36a:
  figura, pasos, terminal real, compruébalo, errores típicos y ejercicio.
- **Servidor.** Server, SSH, pares de claves, sshd_config, SFTP, DNS, nombres y comodines, servidor web, Apache2,
  gestión web, Roundcube y correo, con el mismo guion. Los pasos usan los rótulos exactos de la interfaz en cada idioma.
- **Comprobado en el simulador.** Cada salida y cada ejercicio se ejecutó en el laboratorio «Server: DHCP, DNS, web,
  correo y SSH»: `ss -tulpn`, la sesión SSH y su registro («invalid user ana»), `ssh-copy-id`, solo claves,
  `sftp`/`scp`, `dig` (registro nuevo y su PTR automático; `google.es` con Recursivo y Nombres públicos), el comodín y
  el punto final que falta, el VirtualHost con el error AH00526 y el aviso AH00558, el rebote de postfix por falta de MX
  y los intentos fallidos en la gestión web.
- **Archivos.** DNS, HTTP y correo salen de `services.ts` a `dns.ts`, `http.ts` y `mail.ts` (y sus gemelos en inglés);
  SFTP pasa de `security.ts` a `ssh.ts`. Ninguno pasa de 400 líneas.
- **Figuras.** El ancho de una topología cuenta lo que miden las etiquetas y las notas, para que no se corten en los
  bordes; los routers se apartan del eje para que el cable no cruce su nota.
- **Registro de Apache.** La línea de acceso de la gestión web en otro puerto decía «(puerto 10000)» en español fijo;
  ahora «(port 10000)», como el resto del registro.

**Siguiente:** fase 36c, Switch IOS, Router IOS, Router Linux y Nube.

### Notas de la fase 36c, primera entrega (v0.20.3)

- **Switch IOS.** La CLI, Verificación, Interfaces/VLAN/rutas y Gestión web de routers y switches, en estilo guiado.
  La gestión web pasa de `internet.ts` a `ios.ts`.
- **Router IOS: DHCP.** Servidor DHCP, Reservas y Relay/snooping/router cliente, en un módulo propio `ios-dhcp.ts`.
- **Comprobado en el simulador** (laboratorios DHCP básico, Reservas, Relay, Router-on-a-stick, Snooping y Router
  cliente). Dos salidas se corrigieron: el primer `traceroute` entre VLAN tiene un `*` mientras el router resuelve ARP, y
  `show ip route | include 0.0.0.0` también saca la línea `100.0.0.0/8 …`.
- **Pendiente de 36c:** NAT, ACL e IPsec del router IOS; Router Linux (parámetros, nftables, WireGuard) y Nube.

### Notas de la fase 36c, segunda entrega (v0.20.4)

- **Router IOS: NAT, ACL e IPsec**, en estilo guiado, en un módulo propio `ios-sec.ts`. Comprobado en los laboratorios
  «Internet: dos sedes y DNS públicos» (traducciones y estadísticas de NAT), «Bastionado: ACL, nftables y sshd»
  (contadores de `show access-lists` y avisos `%SEC-6-IPACCESSLOGP`) y «VPN IPsec entre dos sedes (2911)»: se pierden
  dos pings mientras sube el túnel, no uno.
- **ping de Linux.** La línea `rtt min/avg/max/mdev` era fija (0.400/0.455/0.511/0.040 incluso con un paquete); ahora
  sale de los tiempos impresos. Los tiempos se escriben con tres decimales (antes, a partir del paquete 17, `0.1029`).
- **Hecho después (v0.20.9):** el ICMP de una ACL o de una regla `reject` debería ser «administratively prohibited» (Linux: «Packet
  filtered»), y la falta de ruta en un router, «net unreachable»; hoy todo sale como «Destination Host Unreachable».
  `ip -4 addr show eth0` enseña también `lo` y las líneas `link/ether`.

### Notas de la fase 36c, tercera entrega (v0.20.5)

- **Router Linux:** Router Linux, Cortafuegos nftables y VPN WireGuard, en estilo guiado, con una nota que remite a las
  páginas de Servidor para sus servicios. Comprobado en «Router Linux con NAT y DMZ (nftables)» (ip_forward, DNAT a la
  DMZ, `FW-DROP` en dmesg) y «VPN WireGuard: central y sucursal tras NAT» (`wg show`, traceroute por el túnel). Las
  claves de WireGuard cambian en cada carga: en la documentación van como marcadores.
- **Nube:** Nube ISP e Internet emulada y DNS públicos, comprobadas en «Internet: dos sedes y DNS públicos»
  (`curl ifconfig.me`, traceroute a 8.8.8.8, delegación NS de sede2.es). Corregido: a un puerto sin redirección, curl
  dice «Couldn't connect to server», no «Connection refused».
- **Pendiente (fidelidad):** un Ubuntu responde con TTL 128 (el real usa 64) y la línea de `dmesg` de un `log` de
  nftables está simplificada (sin MAC, TOS, ID, TYPE/CODE).

**Siguiente:** fase 36d, Netfix, Conceptos de red, Terminal Linux y bash.

### Fidelidad de red (v0.20.6)

- **Códigos ICMP.** El mensaje «destination unreachable» lleva su código: red (un router sin ruta), host, puerto
  (`reject` por defecto) o prohibido por administración (ACL de IOS, `reject with icmp type admin-prohibited`).
  El `ping` de Linux lo muestra como iputils («Destination Net Unreachable», «Packet filtered»…) y su `traceroute`
  marca `!N`, `!H`, `!P` o `!X`. Windows e IOS siguen como Packet Tracer («Destination host unreachable.», `U`).
- **`reject` en `forward`.** El router Linux responde ahora con el ICMP desde su propia dirección IP (antes, nada).
- **TTL.** Un equipo Linux envía con TTL 64 y uno Windows con 128.
- **`ip [-4] addr show DEV`.** Solo esa interfaz; con -4, solo las que tienen IPv4 y sin las líneas `link/`.
- **Log de nftables.** Como el del núcleo: MAC, LEN, TOS, PREC, TTL (ya decrementado en forward), ID, DF y los campos
  de cada protocolo (TYPE/CODE/ID/SEQ, SPT/DPT/WINDOW/flags, LEN de UDP). El ping de Linux numera desde 1.
- **Hecho en v0.20.9:** IOS solo respondía con ICMP a los ecos; una conexión TCP bloqueada por una ACL acababa en
  timeout en vez de «No route to host».

### Notas de la fase 36d, primera entrega (v0.20.7)

- **Netfix:** Primeros pasos (con «Tu primera red» comprobada: dos PC, un switch y ping), Dibujo, Guardar y abrir,
  Tiempo real y simulación (DORA paso a paso) y Usuarios, en estilo guiado.
- **Conceptos de red:** Broadcast (quién responde y por qué, con salidas reales y (DUP!)) y traceroute/tracert (cómo leer
  `*`, `!N`, `!X` y «reports:»).
- **Arreglos encontrados al comprobar:** un `ping` de IOS a un broadcast sin respuestas saca `.....` y «Success rate is 0
  percent» (antes, un punto por línea); `tracert` de Windows escribe «N  dirección  reports: Destination net
  unreachable.» y el traceroute de IOS marca `!N`, `!H`, `!U` o `!A` (antes repetían la dirección IP como si fuera
  el destino).

### Notas de la fase 36d, segunda entrega (v0.20.8)

- **Terminal Linux:** La Terminal Linux (tu primer script), Sistema de ficheros y permisos (leer `ls -l`, octal), Programas
  (tuberías) y Red desde Linux (diagnóstico en cuatro pasos), nano y vim, en estilo guiado y comprobados en el
  laboratorio «Server: DHCP, DNS, web, correo y SSH».
- **Arreglos encontrados al comprobar:**
  - `ss` respeta sus opciones: `-t`/`-u` filtran, la columna Netid solo sale con más de un tipo, `-l`/`-a` muestran los
    sockets a la escucha (sin ellos, solo las conexiones, que Netfix no lista) y `users:(…)` solo con `-p`.
  - `dig` sin servidor DNS dice «;; communications error to 127.0.0.1#53: connection refused» y «;; no servers could be
    reached» (antes añadía un texto en español).
  - `echo … >> FICHERO` sin permiso falla al abrir («bash: /etc/passwd: Permission denied»), no al escribir.

### ICMP para TCP y UDP (v0.20.9)

- **El error ICMP cita el paquete original** (cabecera IP y puertos), como el real. Un router IOS lo envía también
  para TCP y UDP cuando no hay ruta o una ACL lo deniega (`ip unreachables`), y el `reject` de nftables lo cita igual.
- **Linux aborta el `connect()`** en SYN_SENT con el errno de cada código (`tcp_v4_err`): red → «Network is
  unreachable», host o prohibido → «No route to host», puerto → «Connection refused». Así salen ssh, nc y curl (curl 8:
  «Couldn't connect to server», error 7). **Windows lo ignora** y sigue reintentando hasta el timeout.
- **Nunca sobre una difusión** (RFC 1122 3.2.2, RFC 1812 4.3.2.7): ni a un destino de difusión o multidifusión ni a un
  origen 0.0.0.0. Un ping a la difusión dirigida de una red lejana denegado por una ACL ya no recibe «Packet filtered».
- **Con NAT de entrada**, la cita es el paquete tal como lo envió su origen (antes de la traducción).
- **Documentación:** el ejercicio de ACL explica el «No route to host» de ALUMNO.

### bash: -n, traza de set -x y subíndices (v0.20.10)

Encontrado al preparar la documentación de bash (fase 36d), contrastado con el bash real en el corpus
(`16-invocation`, `17-xtrace`, `18-subscripts`):

- **`bash -n` y `set -n`** analizan sin ejecutar (antes, `bash -n script.sh` lo ejecutaba). Un shell interactivo lo
  ignora, como bash.
- **Traza (`set -x`, `bash -x`)** como la de bash: `for`, `select` y `case` con su texto; cada prueba de `[[ ]]` en su
  línea (con `!` y los caracteres citados del patrón tras `\`); `((  expr  ))` con `$var` expandida (y sin ejecutar dos
  veces una `$( )`); `for (( ))`; cada asignación en su línea; `declare`/`local`/`export`/`readonly` como bash; un `+`
  más por cada nivel de `$( )` o `<( )`, también en sus subshells y tuberías (módulo `src/bash/xtrace.ts`).
- **`([a b]=1)`, `([1 + 1]=two)`, `([x[1]]=1)`**: el subíndice de un elemento llega hasta su `]` aunque tenga blancos o
  corchetes. **`declare -p`** pone entre comillas las claves asociativas con metacaracteres (`["a b"]="1"`).
- **Hecho en v0.21.2:** el orden de las claves de un array asociativo en `declare -p` sigue al de inserción; bash usa el de su
  tabla hash. `[[ ! ( -z a ) ]]` se traza con `!` (bash no lo muestra con paréntesis).

### Notas de la fase 36d, tercera entrega (v0.21.0): bash. Fase 36 completada

- **bash: Lenguaje** (sintaxis, expansiones, scripts y estructuras de control, funciones y arrays, redirecciones) en
  estilo guiado: pasos, terminales reales, avisos y un ejercicio por página, comprobados en la Terminal Linux de PC1
  del laboratorio «Server: DHCP, DNS, web, correo y SSH». «Tu primer script» (`tipo.sh`) recorre nano, chmod, `bash -n`,
  la ejecución, `$?` y `bash -x`.
- **bash: Referencia**: variables y prompt, opciones, teclado e historial y novedades de 5.3 llevan introducción,
  pasos, terminal, aviso y ejercicio; las órdenes internas siguen generándose de `bash-builtins.ts`.
- **Resaltado `sh`** (como `syntax/sh.vim`) para los `.sh`, `.bash`, `.bashrc`, `.profile`…: en la documentación y en el
  vim de Netfix.
- **Arreglo encontrado al comprobar:** con finales de línea CRLF, «command not found» cita el nombre como bash
  (`$'ls\r'`), con su caso en el corpus.
- **Resaltado `sh` sin falsos positivos** (revisión): `-x` solo como operador de test tras un blanco o un corchete (no
  `ls -la`), las palabras clave no dentro de rutas o palabras con guion, `#` solo al empezar una palabra y `profile`
  solo como `/etc/profile`.
- **Fase 36 completada:** todos los grupos de la documentación siguen el orden de la paleta y el estilo guiado.

### Fase 37: pendientes, nslookup interactivo, ayuda (v0.21.x)

- **Documentación → Ayuda / Help**, como en las aplicaciones de escritorio: pestaña, título, búsqueda, `man`, `help` y
  la nota E149 de vim.
- **Iconos** para Conceptos de red (nodos enlazados), Terminal Linux (ventana con `>_`) y GNU bash (hoja con `#!`),
  dibujados con las variables de color de los dispositivos para que sigan el tema claro y el oscuro. Son genéricos:
  ni la mascota de Linux ni el logotipo de GNU.
- **nslookup interactivo (v0.21.1)** en la Terminal Linux (BIND 9) y en la Windows: sin nombre (o con `-`) muestra
  `>` y acepta NOMBRE [SERVIDOR], `server`/`lserver`, `set type=` (querytype, q), `set [no]debug` (volcado por
  secciones), `set all`, `help` y `exit` (Ctrl+C en Windows). Fuera de él, `-type=`, `-debug` y las opciones que no
  cambian nada (`-timeout=`, `-norecurse`…). Todos los tipos de registro con el formato de cada sistema (MX, NS, TXT,
  SOA, CNAME, PTR), una dirección IP se busca en la zona inversa, «No answer» con la SOA de la autoridad, y Windows
  nombra el servidor por su PTR («UnKnown» si no lo hay). El estado de salida de Linux sale del resultado, no del texto.
- **Pendientes pequeños (v0.21.2):**
  - bash lista las claves de un array asociativo en el orden de su tabla hash (FNV-1 sobre los bytes, 1024 cubetas
    que crecen ×4, la clave nueva delante de su cubeta), comprobado con bash real hasta 3000 claves; el orden se
    guarda mientras no cambien las claves.
  - `set -x` no muestra el `!` delante de un grupo entre paréntesis (`[[ ! ( a == b ) ]]` → `+ [[ a == b ]]`) y
    `declare -f` conserva los paréntesis.
  - Errores ICMP relacionados a través de NAT (RFC 5508): el NAT de IOS, la nube ISP y el masquerade de nftables
    devuelven el error al equipo interno con la cabecera citada traducida, así que una conexión denegada más allá
    del NAT falla al momento («No route to host») en vez de agotar el tiempo.
- **WireGuard frente a la repetición (v0.21.3):** el inicio del handshake lleva una marca TAI64N autenticada y el
  que responde ignora la que no sea más reciente que la última aceptada de ese par; los contadores de datos y de
  keepalive se comprueban con una ventana deslizante de 8128 y empiezan de cero en cada sesión.
- STP (PVST+) en los switch 2960: fase 38 (v0.22.0).

### Fase 38: spanning tree (PVST+) en los switch 2960 (v0.22.0)

Objetivo: que dos enlaces entre switches no formen un bucle, como en Packet Tracer, y que el alumno vea y cambie la
elección con las órdenes de IOS 15.

- **Cálculo** (`src/net/stp.ts`, puro): por VLAN, los switch con puertos activos en ella forman dominios; se elige la
  raíz por el identificador de puente (prioridad + VLAN por `extend system-id`, después la MAC), el puerto raíz por
  el menor vector {raíz, coste, puente emisor, puerto emisor, puerto propio} y el designado de cada enlace por el
  menor {raíz, coste, puente, puerto}; el resto queda Altn BLK. Costes cortos (Fa 19, Gi 4), puerto 128.N.
- **Convergencia inmediata**: la red se calcula al cambiar (cable, shutdown, modo del puerto, VLAN, prioridad) y no
  pasa por Listening/Learning (en un 2960 real tarda 30 s). Así los laboratorios no esperan y el resultado es el mismo.
- **Datos**: un puerto BLK no aprende MAC ni reenvía tramas de esa VLAN. `no spanning-tree vlan N` lo apaga (vuelve
  el bucle, para las pruebas de tormenta).
- **Órdenes**: `spanning-tree mode pvst|rapid-pvst`, `spanning-tree vlan L priority P` (múltiplos de 4096),
  `spanning-tree vlan L root primary|secondary`, `no spanning-tree vlan L`; en la interfaz `spanning-tree cost`,
  `port-priority`, `portfast` (con el aviso de IOS) y `bpduguard enable` (se guarda; el err-disable queda pendiente).
  `show spanning-tree [vlan N | interface IF | summary]` con el formato de IOS 15. running-config y fichero las guardan.
- **Interfaz**: el triángulo del extremo de un cable se pinta ámbar en un puerto que bloquea.
- **Pruebas**: cálculo puro (triángulo, empate por MAC y por puerto, prioridades), integración (sin tormenta, ping a
  través del árbol, caída del puerto raíz y reelección), salidas de show y configuración.
- **Hecho (v0.22.0):** todo lo anterior, el laboratorio «Spanning tree: tres switches en triángulo» y la página de
  ayuda «Spanning tree» (Switch IOS). Las pruebas de tormenta apagan STP con `no spanning-tree vlan 1`.
- **Pendiente:** Listening/Learning con sus 30 s y BPDU visibles en el modo simulación; err-disable por bpduguard;
  `switchport trunk allowed vlan` (hoy un troncal lleva todas las VLAN).

### Fase 39: aviso de cambios sin guardar al cambiar de laboratorio (v0.22.1)

- **Qué es «sin guardar»:** la huella (SHA-256 del JSON de la topología) difiere de la del último momento en que se
  cargó o se guardó en un archivo. Se guarda junto al autoguardado del navegador, así que sobrevive a recargar la
  página y a cambiar de idioma (la interfaz se reconstruye). El JSON no cambia con el paso del tiempo simulado (prueba
  con todos los laboratorios).
- **El aviso:** al elegir un laboratorio con cambios sin guardar, un diálogo modal (`<dialog>`) explica que se
  perderán y ofrece **Cancelar** (el foco por defecto; también Esc) o **Abrir el laboratorio**. Sin cambios, abre sin
  preguntar.
- **«Área de trabajo en blanco» desaparece** del desplegable: hace lo mismo que **Nuevo**.
- `src/ui/workspace-store.ts` (autoguardado y huella) y `src/ui/confirm-dialog.ts` salen de `main.ts`, que pasaba de
  400 líneas.
- Pruebas: unidad (huella, marcado, estabilidad en el tiempo) y e2e (cambio → aviso → Cancelar conserva; Abrir cambia;
  sin cambios no pregunta; ya no está el área en blanco).
- **Hecho (v0.22.1):** como en el plan. «Guardar» solo marca la red como guardada si el archivo se escribió o se
  copió (no al cancelar ni si falla el portapapeles). Embebido, la huella vive en memoria y se reinicia con cada
  `embed`. `undo-keys.ts`, `readTopologyFile` e `initialWorkspace` también salen de `main.ts`.
- **Revisión:** la huella usa JSON con las claves ordenadas, y guardar y cargar cualquier laboratorio da la misma
  huella. Eso destapó un fallo real: al cargar el laboratorio SSH, /home/ana quedaba de root (los directorios padre
  de un archivo restaurado se marcaban como escritos por el usuario y se guardaban); ahora son del sistema y la casa
  pasa a su usuario. Con un diálogo abierto no se abre otro ni actúan los atajos; si la interfaz se rehace mientras
  pregunta, la respuesta ya no cambia la red. Un id `blanco` en las restricciones del aula simplemente no coincide.

### Fase 39b: el mismo aviso en Nuevo y Abrir… (v0.22.2)

- **Nuevo** y **Abrir…** preguntan igual que el desplegable cuando hay cambios sin guardar: «Empezar una red nueva» o
  «Elegir otro archivo» frente a **Cancelar**. Abrir pregunta antes de mostrar el selector de archivos (como las
  aplicaciones de escritorio), así que cancelar no abre nada.
- Una sola comprobación en `main.ts` (`replaceAllowed`) para los tres caminos: sin diálogo abierto, red cambiada y
  la misma interfaz (no reconstruida en otro idioma) al responder.
- e2e: Nuevo con cambios → Cancelar conserva y Empezar vacía; Abrir con cambios → Cancelar no abre el selector y
  aceptar sí; sin cambios, ninguno pregunta.
- **Hecho (v0.22.2):** como en el plan; la ayuda lo dice en la fila de Nuevo · Abrir… · Guardar. Las páginas (Ayuda,
  Donaciones, Acerca de) salen a `src/ui/pages.ts` para que `main.ts` siga por debajo de 400 líneas.

### Fase 40: lo pendiente de spanning tree y de los troncales — plan

Revisados los «Pendiente» anteriores: el TTL 64 de Ubuntu, la línea completa del registro de nftables (`klog.ts`), los
`reject with` y la salida de IOS de un ping a broadcast sin respuesta ya están hechos; la documentación de 36c también.
Queda lo de spanning tree, en tres entregas:

- **40a · `switchport trunk allowed vlan`** (lista, `add`, `remove`, `except`, `all`, `none`): un troncal solo lleva
  esas VLAN (en las dos direcciones y en el árbol de cada VLAN), con su línea en running-config y
  `show interfaces trunk` como IOS 15 (modo, encapsulación, VLAN nativa; permitidas, activas y en reenvío de STP).
- **40b · BPDU guard:** un puerto con `spanning-tree bpduguard enable` (o `portfast bpduguard default` con portfast)
  que tiene un switch al otro lado pasa a **err-disabled** con los mensajes `%SPANTREE-2-BLOCK_BPDUGUARD` y
  `%PM-4-ERR_DISABLE`; el enlace cae, `show interfaces status` lo dice y `shutdown` + `no shutdown` lo recupera.
- **40c · Tiempos y BPDU:** en la interfaz (no en las pruebas ni al cargar, que siguen convergidas) un puerto que pasa a
  reenviar recorre Listening (15 s) y Learning (15 s) salvo con portfast o en `rapid-pvst`; luz ámbar mientras tanto.
  En el modo simulación se ven las BPDU (cada 2 s, desde los puertos designados), con su filtro STP.
- **Hecho 40a (v0.22.3):** `switchport trunk allowed vlan` y `show interfaces trunk`, en la ayuda de Switch IOS. Las
  listas de VLAN («1,3-5») quedan en `src/core/vlans.ts` (antes repetidas en snooping y spanning tree).
- **Hecho 40b (v0.22.4):** BPDU guard con err-disabled, `spanning-tree portfast bpduguard default`,
  `show interfaces status [err-disabled]` y «(err-disabled)» en `show interfaces`. La lógica de spanning tree del switch
  pasa a `src/devices/switch-stp.ts`.
