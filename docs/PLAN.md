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

