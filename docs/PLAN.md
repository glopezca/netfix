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
- **Hecho 40c (v0.23.0):** tiempos de STP y BPDU. `Network.startStp()` (lo llama el panel de simulación al cargar una
  red en la interfaz) superpone Listening/Learning (`src/net/stp-timers.ts`) al árbol convergido y envía las BPDU
  cada 2 s; las pruebas y la carga siguen sin tiempos. El filtro STP del panel empieza desmarcado. Fase 40 completada.
- **Revisión 40c:** las BPDU y los despertares de los tiempos son tareas de fondo: no cuentan en `pending()`, así que el
  modo simulación no avanza el reloj solo por ellas; un despertar por plazo. Queda como posible mejora agrupar los
  recálculos del árbol en ráfagas grandes (`interface range` de 24 puertos) y enviar menos BPDU con muchas VLAN.

## Fase 41 · Pestaña Configuración: ajustes generales y del laboratorio (v0.24.0)

Modelos (regla del proyecto): opus en la sesión principal (cruza red, interfaz y fichero), revisión con
`code-reviewer` (sonnet) y `security-reviewer` (opus, el fichero de topología trae un campo nuevo sin validar).

- **Vista nueva «Configuración» / «Settings»** junto a Ayuda, con dos apartados.
- **Generales** (de este navegador, en localStorage): idioma, tema (automático, claro, oscuro; el CSS ya tiene
  `data-theme`) y avisar de los cambios sin guardar.
- **Laboratorio actual** (se guarda con la topología, `features`, solo lo que difiere de lo predeterminado): qué
  ajustes de cada tipo de equipo están activos. «Equipo» (nombre de host) e «Interfaces» siempre lo están.

  | Equipo | Activado por defecto | Se puede activar |
  |---|---|---|
  | PC | Configuración IP, aplicaciones (navegador, correo, SSH, SFTP), terminal Linux y terminal Windows | — |
  | Servidor | Configuración IP, servicios, terminal Linux y Windows | Parámetros del kernel, firewall |
  | Router Linux | Parámetros del kernel, firewall, VPN, servicios, terminal Linux | Terminal Windows |
  | Router y switch IOS | CLI, gestión web | — |

  Todo lo activado por defecto se puede desactivar. Las restricciones del aula siguen mandando (lo efectivo es la
  intersección). Al cambiar algo se cierran las ventanas abiertas (se reabren con las pestañas nuevas) y cuenta como
  cambio sin guardar. Embebido en el aula, el apartado del laboratorio es de solo lectura.
- **Módulos:** `src/net/lab-features.ts` (puro: catálogo, valores por defecto, validación del JSON),
  `Topology.features`, `src/ui/settings-view.ts`, `device-windows.ts` y `server-apps.ts` consultan los ajustes.
- **Pruebas:** unidad (por defecto, cambios normalizados, JSON hostil, ida y vuelta del fichero) y e2e (desactivar el
  terminal Windows de los PC lo quita de la ventana; activar el firewall del servidor lo añade; tema; recarga).
- **Hecho (v0.24.0):** como en el plan, con su página de ayuda (Netfix → Configuración). La validación del fichero de
  topología pasa a `src/net/topology-file.ts`. Revisión (sonnet y opus): la página se actualiza al cargar otra red, las
  casillas no pierden el foco y un mensaje con `role="status"` dice el cambio; el tema se aplica antes de pintar (y no
  en la página que embebe Netfix); «Configuración IP» lleva también el sistema operativo del PC; el JSON hostil
  (listas enormes, `__proto__`) se descarta. Pendiente: en el aula, las restricciones van por pestañas y no pueden
  ocultar los paneles del servidor (kernel, firewall) que un fichero active.

### Fase 41b: servicios uno a uno, ajustes de cada laboratorio grabado y prompt con hora global (v0.24.1)

- **Servicios uno a uno:** en Configuración → Laboratorio actual, el servidor y el router Linux tienen una casilla por
  panel (SSH, DHCP, DNS, HTTP, correo, ficheros, registros) en lugar de «Servicios». En una red nueva (Nuevo) el
  servidor los lleva todos menos parámetros del kernel y firewall, como hasta ahora.
- **Laboratorios grabados:** cada uno trae sus ajustes (`src/net/lab-presets.ts`): solo los servicios que usa. Bastionado
  añade parámetros del kernel y firewall al servidor. Un laboratorio sin servidores no cambia los valores por defecto
  (si el alumno añade uno, lo tiene completo).

  | Laboratorio | Servidor | Router Linux |
  |---|---|---|
  | Server: DHCP, DNS, web, correo y SSH | SSH, DHCP, DNS, HTTP, correo, ficheros, registros | — |
  | Internet: dos sedes | SSH, DNS, HTTP, ficheros, registros | — |
  | DNS que reenvía | DHCP, DNS, ficheros, registros | — |
  | SSH y SFTP | SSH, DNS, ficheros, registros | — |
  | Bastionado | SSH, DNS, HTTP, ficheros, registros, kernel, firewall | — |
  | Router Linux con DMZ | HTTP, ficheros, registros | kernel, firewall, ficheros, registros |
  | VPN WireGuard | — | kernel, firewall, VPN, SSH, ficheros, registros |

- **Prompt con fecha y hora:** deja de ser de cada equipo y de la red; es un ajuste general de este navegador
  (Configuración → Generales y la casilla del pie de las terminales, que ahora cambia todas), desactivado por defecto.
  El bloqueo del aula sigue mandando. Los ficheros antiguos con `timestampPrompt` se abren sin error (se ignora).
- **Hecho (v0.24.1):** como en el plan (`src/net/lab-presets.ts`, `SERVICE_IDS`), con la ayuda al día (Configuración,
  Terminal Linux y Terminal Windows) y el e2e del router Linux de la DMZ ajustado a sus paneles.

### Fase 41c: la pestaña Ayuda, penúltima (v0.24.2)

- Orden de las vistas en la barra superior: Red, Configuración, Donaciones, **Ayuda**, Acerca de (`VIEWS` en
  `src/ui/topbar.ts`). Prueba: el e2e general comprueba que las dos últimas son Ayuda y Acerca de.
- **Hecho (v0.24.2).**

### Fase 42: pestaña Configuración de cada equipo, SO al colocar un PC y opciones desactivadas en la gestión web (v0.25.0)

Petición: cada equipo tiene una pestaña Configuración que activa sus aplicaciones, servicios y terminales dentro del
máximo del laboratorio; los PCs llevan normalmente un solo terminal; al colocar un PC se pregunta el SO; la gestión
web de Server y router Linux muestra lo desactivado en gris, o lo oculta con un ajuste del laboratorio.

- **Catálogo por equipo** (`src/net/device-apps.ts`, nuevo): PC = IP, navegador, correo, SSH, SFTP, terminal Linux y
  Windows; Server y router Linux = los paneles de la fase 41b. Disponible = laboratorio (`featureOn`; en el PC el
  interruptor `apps` cubre las cuatro aplicaciones) **y** equipo. Por defecto del equipo: PC con IP, navegador y SSH
  (correo y SFTP apagados) y el terminal de su SO; Server y router Linux con todo y el terminal de su SO (Linux).
  Se guarda por equipo solo si se cambió (`enabled` en el registro del archivo; desconocidos y repetidos fuera).
  Registro débil (WeakMap) como `seeds`, para no tocar `host.ts` (398 líneas) y que la web lo lea sin importar la UI.
- **Topología:** `add()` enlaza cada equipo con la vista del laboratorio (sus `features` y `webHideOff`); el archivo
  guarda `webHideOff: true` solo si está activado.
- **Laboratorios grabados:** las parejas de PCs del mismo switch, uno Windows y otro Linux (`lanBase`, relay, y
  ssh-sftp con PC0 Windows); correo solo en los PCs con cuenta; SFTP en PC1 de «SSH y SFTP»; cada servidor, solo los
  servicios que arranca (más ficheros y registros), y SSH en SRV-SEDE2 de «Internet» (el ISP redirige el 22).
- **Ventana del equipo:** pestaña «Configuración» (id `apps`) con casillas por grupo (aplicaciones, servicios,
  terminales) de lo que el laboratorio permite; al cambiar, la ventana se reabre en esa pestaña. Las pestañas y
  paneles siguen lo disponible (navegador, correo, SSH, SFTP por separado).
- **Colocar un PC:** diálogo «Linux / Windows / Ambos» con la nota de que se cambia luego en Configuración; fija el SO
  (pestaña IP) y los terminales. Escape = Windows (el valor por defecto). Los servidores no preguntan (Linux).
- **Gestión web** (`admin-layout.ts`, `server-admin.ts`): página de una opción apagada → en el menú en gris
  (`aria-disabled`), al abrirla un aviso sin formularios y un POST se rechaza sin ejecutar nada; con «Ocultar en la
  gestión web lo desactivado» (Configuración → Laboratorio actual) ni aparece. Mapa: ssh, dhcp, dns, web→http, mail,
  routing→sysctl, firewall, vpn, files, log; Configuración, Administración y Estado siempre.
- **Pruebas:** unidad del catálogo y del archivo, laboratorios (parejas, correo, SFTP, servicios), gestión web (gris,
  POST rechazado, oculto); e2e: diálogo al colocar un PC, pestaña Configuración que quita SFTP, menú web en gris.
- **Docs es/en:** Configuración (pestaña del equipo, pregunta del SO, ajuste de la web), Gestión web.
- Fuera de alcance: routers y switches IOS siguen con el ajuste del laboratorio (CLI y web), sin pestaña propia.
- **Hecho (v0.25.0):** como en el plan, con el e2e `scripts/e2e-devices.mjs` y los e2e anteriores apuntando al PC del
  sistema que usan (PC1 Linux en «Server», o añadiendo su terminal Linux desde Configuración).
- **Revisión (v0.25.0):** archivos anteriores sin `enabled` mantienen Correo en los PCs con cuenta; `apps` en las
  pestañas que el profesor puede listar (`TAB_IDS`, EMBED.md); una página apagada pedida por su dirección (también
  oculta) responde con el aviso y su POST no ejecuta otra acción; la ventana reabierta recibe su sitio como argumento.

### Fase 43: apt en GNU/Linux, servidores sin servicios de serie, huevos de Pascua y «GNU/Linux» (v0.26.0)

Petición: `apt` en los terminales GNU/Linux con las fuentes reales de Ubuntu 26.04 (resolute) y alcance limitado;
solo funciona con salida a la Internet emulada y DNS que resuelvan los repositorios. Servidores y routers nuevos sin
servicios (salvo parámetros del kernel); `apt install/remove` activa o quita la casilla del servicio. Huevos de
Pascua en la ayuda (créditos de mc y `apt moo`). «Linux» como SO pasa a «GNU/Linux».

- **Fuentes:** `/etc/apt/sources.list` (solo el comentario de Ubuntu) y `/etc/apt/sources.list.d/ubuntu.sources`
  (deb822: archive.ubuntu.com resolute, -updates, -backports; security.ubuntu.com resolute-security), copiados del
  formato real de 24.04 con la suite cambiada.
- **Red real:** cada fuente se comprueba con el resolutor y una petición HTTP de su `InRelease` por la red simulada.
  Errores reales: sin DNS que responda «Temporary failure resolving 'x'»; NXDOMAIN «Could not resolve 'x'»; sin
  ruta o filtrado «Could not connect to x:80 (ip), connection timed out»; rechazo «… - connect (111: Connection
  refused)». `apt update`: Hit:/Err: y «All packages are up to date.» con los avisos `Warning: Failed to fetch …`.
- **Catálogo ficticio** (`src/shells/apt-catalog.ts`): paquetes de servicio con su versión y dependencias
  (openssh-server/ssh → SSH; kea-dhcp4-server/kea → DHCP; bind9 → DNS; apache2 → HTTP; postfix, dovecot-imapd,
  dovecot-pop3d → correo; nftables → firewall; wireguard/wireguard-tools → VPN; rsyslog → registros) y paquetes
  base (no se pueden quitar: «Removing essential system-critical packages is not permitted»).
- **Órdenes** (formato de apt 3): `update`, `upgrade`/`full-upgrade` (todo al día), `autoremove` (nada que quitar),
  `install`/`remove`/`purge` (descarga simulada que pasa tiempo de simulación, `Continue? [Y/n]` salvo `-y`,
  efecto real en la casilla del equipo), `list --installed`, `moo` (idéntico al real: 1, 2 o 3 «moo», frases de
  fechas especiales y el del 1 de abril, según el reloj simulado). Sin root: el error real del bloqueo de dpkg.
- **Equipos:** Server y router GNU/Linux nuevos: IP, ficheros, registros y su terminal; ningún servicio. Los
  parámetros del kernel no tienen casilla: se ven siempre (si el laboratorio no los quita). La página Enrutamiento de
  la gestión web depende de nftables (firewall). En el laboratorio, servidor con parámetros y firewall por defecto
  (la casilla del equipo decide). Archivos anteriores sin `enabled`: los servidores conservan todos sus servicios.
  Un cambio de casillas (casilla o apt) reabre la ventana abierta del equipo en la pestaña donde estaba.
- **DNS públicos:** más nombres de los repositorios (es.archive, ports, changelogs, keyserver, esm, api.launchpad).
- **Ayuda:** apt en Órdenes (utils), página «Huevos de Pascua» (mc y apt moo), Configuración al día.
- **GNU/Linux:** en la interfaz y la ayuda, «Linux» como sistema operativo pasa a «GNU/Linux» (Terminal GNU/Linux,
  Router GNU/Linux…); el kernel, `uname` y las salidas reales no cambian.
- **Pruebas:** apt con y sin red (DNS caído, NXDOMAIN, sin ruta), install/remove con efecto, root, moo y fechas,
  catálogo, valores por defecto, migración; e2e: `sudo apt install apache2` en el terminal añade HTTP a Servicios.
- **Hecho (v0.26.0):** como en el plan, con dos ajustes: los laboratorios grabados ya no limitan servicios a nivel de
  laboratorio (LAB_PRESETS fuera: cada equipo muestra lo que usa y lo que se instale con apt aparece siempre), y «sin
  servicios» se aplica a los equipos colocados desde la paleta (los archivos y laboratorios conservan lo suyo, sin
  migración). `apt moo` comprobado contra el apt real (1, 2 y 3 moos, seis fechas). e2e nuevo `scripts/e2e-apt.mjs`.
- **Revisión (v0.26.0):** en un PC apt no toca sus clientes SSH ni de correo (no tiene paneles de servicio); cada
  paquete de correo sigue a su servicio (postfix, dovecot-imapd, dovecot-pop3d) y el panel se queda mientras quede
  uno; no se vuelven a descargar dependencias ya instaladas; `apt list` sin `--installed` y con patrón; las opciones
  con valor (-o, -t, -c) no se toman por la orden; fin de la entrada en «Continue?» aborta.

### Fase 44: paquetes instalables en todos los GNU/Linux: nmcli y mDNS (v0.27.0)

Petición: `apt install` de dos paquetes en cualquier terminal GNU/Linux (PC, Server, router): **nmcli** (NetworkManager)
con información completa de interfaces y red, y **mDNS** para hacer ping por nombre sin servidor DNS. Base para más
paquetes instalables.

- **Paquetes instalados guardados** (`src/net/host-packages.ts`, registro débil como device-apps): lo que apt instala que
  no es un panel de servicio queda en el equipo y en el archivo (`packages`, validado). apt-state lo usa.
- **network-manager** (`src/shells/nmcli.ts`): sin instalar, «Command 'nmcli' not found, but can be installed with:
  sudo apt install network-manager». Instalado: `nmcli` (resumen por dispositivo, DNS), `general [status]` (con la
  comprobación real de conectividad a connectivity-check.ubuntu.com: full / limited / none), `device [status]`,
  `device show [IFACE]`, `connection [show [NOMBRE]]`, `networking`, `--version`; abreviaturas (d, dev, c, con, g…) y
  los errores reales. Conexiones «netplan-eth0» (NetworkManager como renderer de netplan) y lo.
- **avahi-daemon** (+ libnss-mdns): responde por mDNS a `<hostname>.local`; con libnss-mdns, `ping pc1.local`, ssh, curl…
  preguntan por mDNS antes que al DNS (`mdns4_minimal [NOTFOUND=return]`). Paquetes reales: multicast 224.0.0.251:5353
  (MAC 01:00:5e:00:00:fb) por la red simulada, que no pasa de un router; respuesta unicast al puerto del que pregunta.
  Registro de sockets locales en `ipstack.ts` (miembros de grupo y datagramas que toma un servicio) para no tocar host.ts.
- **Ayuda:** página de apt (paquetes instalables), referencia de `nmcli`, y mDNS en Red y servicios desde GNU/Linux.
- **Pruebas:** nmcli antes/después de instalar y sus salidas, persistencia, conectividad; mDNS entre dos GNU/Linux del
  mismo switch, no a través de un router, no sin avahi en el destino, cortafuegos; e2e en el terminal.
- **Hecho (v0.27.0):** como en el plan; revisión: los puertos de las consultas mDNS (52000-59999) no chocan con el
  resolutor y solo se acepta la respuesta desde el 5353; el nombre que publica avahi es el de ahora (hostname); el
  registro de mDNS lo hace topology.ts al cargar; un router nunca reenvía 224.0.0.0/4; nmcli con -t/-f/-g, todos
  los perfiles en `connection show`, `networking connectivity` y `general hostname`.

### Fase 44b: mDNS de serie en Windows, como en un PC real (v0.27.1)

(nmcli en Windows, descartado: no existe en un Windows real.) Windows 10 1803+ y 11 traen mDNS en su cliente DNS: sin
instalar nada, el equipo responde a `NOMBRE.local` y pregunta por los nombres `.local` (cmd: `ping pc1.local`).
- **Quién:** todo equipo cuyo sistema (Configuración IP) es Windows: PC y Windows Server. Los GNU/Linux siguen con
  avahi-daemon / libnss-mdns (fase 44).
- **Paquetes como Windows:** pregunta desde el puerto 5353 y la respuesta va por multicast al grupo (no la unicast
  «legacy» de nss-mdns); el que responde contesta así a quien pregunte desde 5353, sea Windows o no.
- **Pruebas:** Windows ↔ Windows sin instalar nada; Windows ↔ GNU/Linux con avahi; respuesta multicast en el cable;
  no cruza routers; `nslookup` sigue sin usar mDNS (como el real). Ayuda: apt (mDNS) y terminal Windows.
- **Hecho (v0.27.1).**

### Fase 45: NetBIOS (nmb/smb) en Windows y samba, resolución nativa, Simulación, avahi obligatorio y «TCP/IP» (v0.28.0)

Petición: NetBIOS/smb/nmb en Windows con su resolución de nombres nativa; Simulación que recoja bien mDNS y NetBIOS
con sus PDU; samba instalable con apt en GNU/Linux (documentado) para usar NetBIOS desde allí; en GNU/Linux mDNS
siempre con avahi, como en la realidad; la pestaña «Configuración IP» pasa a «TCP/IP».

- **Hallazgo:** el panel de Simulación descartaba los paquetes MDNS (su lista de protocolos no los tenía). Se añaden
  MDNS, NBNS y SMB a los filtros, con su color, su línea (`MDNS A? pc1.local`, `NBNS Query PC2<00>`) y su detalle
  (UDP 5353 · mDNS; UDP 137 · NetBIOS Name Service: transacción, operación, nombre<sufijo>, B-node, direcciones o
  tabla de nombres con la MAC).
- **NBNS** (`src/net/netbios.ts`, como mdns.ts): consulta de nombre por broadcast de la subred al puerto 137 (B-node,
  no cruza routers) y respuesta unicast; petición de estado de nodo (NBSTAT) unicast con la tabla de nombres y la MAC.
  Responden los equipos Windows (NetBIOS sobre TCP/IP de serie) y los GNU/Linux con samba (nmbd): NOMBRE<00>,
  WORKGROUP<00> (grupo) y NOMBRE<20> (servidor de ficheros). Caché de nombres por equipo (10 min).
- **SMB:** Windows y samba (smbd) escuchan TCP 139 y 445 (nc/nmap los ven abiertos); `listen` de tcp.ts admite una
  condición. `net view \\EQUIPO` en Windows: «There are no entries in the list.» o «System error 53…».
- **Resolución por cliente:** `resolveHost(host, nombre, cliente)`. Windows: hosts → (.local: mDNS) → DNS con sufijo →
  NetBIOS (nombre de una etiqueta, caché primero). GNU/Linux: el orden de `hosts:` en **/etc/nsswitch.conf** (por
  defecto `files dns`, como Ubuntu Server): `mdns4_minimal [NOTFOUND=return]` lo añade el postinst de libnss-mdns
  (avahi-daemon lo trae) y lo quita al desinstalar; `wins` (winbind + libnss-winbind) se añade a mano, como en la
  realidad. Así, desde GNU/Linux mDNS necesita siempre avahi aunque el sistema del equipo sea Windows.
- **Windows:** `nbtstat -n | -a NOMBRE | -A IP | -c | -R` con su formato; `net view`.
- **GNU/Linux (apt):** `samba` (smbd + nmbd; trae samba-common-bin con `nmblookup [-A] NOMBRE|IP`), `winbind`,
  `libnss-winbind`. Ayuda: apt (NetBIOS y samba), Terminal Windows (nbtstat, net view), Simulación.
- **«TCP/IP»:** pestaña, casilla del laboratorio y del equipo, ayuda, pruebas y e2e.
- **Pruebas:** NBNS Windows↔Windows y Windows↔samba, no cruza routers, nbtstat, nmblookup, nsswitch (mdns y wins),
  avahi obligatorio en GNU/Linux, puertos SMB; Simulación: filtros y detalle de MDNS y NBNS (e2e).
- **Hecho (v0.28.0)**, con la revisión: el cliente por defecto es el sistema del equipo (navegador, correo, ssh y curl
  de Windows resuelven a la manera de Windows) y los programas de la terminal GNU/Linux piden siempre la de GNU/Linux;
  nsswitch.conf se siembra con mdns4_minimal si libnss-mdns ya estaba instalado (archivos anteriores); la línea
  `hosts:` vacía no se come la siguiente; un equipo sin NetBIOS no se queda los datagramas del 137.

### Fase 46: LLMNR en Windows, ayuda y laboratorios de resolución de nombres, laboratorios por temas (v0.29.0)

Petición: LLMNR nativo en los equipos Windows; ayuda y laboratorios para la resolución de nombres por los distintos
protocolos; los laboratorios agrupados por temas para encontrarlos mejor.

- **LLMNR** (`src/net/llmnr.ts`, RFC 4795): pregunta en formato DNS a 224.0.0.252, UDP 5355, TTL 1, desde un puerto
  efímero; responde por unicast el equipo Windows cuyo nombre es (de una etiqueta, sin distinguir mayúsculas). No
  cruza routers. Solo Windows (los GNU/Linux de Netfix no lo hablan).
- **Orden de Windows** para un nombre de una etiqueta: hosts → DNS (con sufijo) → LLMNR y NetBIOS **a la vez**
  (como Windows 10/11): gana la respuesta LLMNR; si no llega, la de NBNS. `.local` sigue por mDNS.
  netbios.ts y llmnr.ts ofrecen consultas asíncronas; `src/net/win-names.ts` las lanza juntas en un solo `runSync`.
- **Simulación:** filtro LLMNR con su color, línea `LLMNR A? pc2` y detalle «UDP x → 5355 · LLMNR».
- **Laboratorios de nombres** (`src/net/labs-names.ts`): «Nombres sin servidor DNS» (una LAN con dos Windows, un
  GNU/Linux con avahi y otro sin nada: hosts, mDNS, LLMNR, NetBIOS) y «Nombres entre redes» (dos LAN unidas por un
  router con un servidor DNS: lo que cruza el router y lo que no, sufijo DNS del DHCP).
- **Grupos de laboratorios:** `LAB_GROUPS` en examples.ts (DHCP; Conmutación y VLAN; Servicios; Resolución de
  nombres; Internet y VPN; Seguridad), `<optgroup>` en el selector (sin grupos vacíos si el aula oculta laboratorios).
  Una prueba exige que cada laboratorio esté en un solo grupo.
- **Ayuda:** página «Resolución de nombres» en Conceptos de red (es/en): orden de cada sistema, tabla de protocolos
  (puerto, alcance, quién responde), cómo verlo en Simulación y ejercicios con los dos laboratorios.
- **Hecho (v0.29.0)**, con la revisión: sin respuesta, Windows repite la pregunta LLMNR a los 410 ms (como el real).
  El laboratorio «LAN sin DNS propio» sale a Internet (ISP-Norte, DNS 8.8.8.8) para que LNX2 pueda instalar avahi o
  samba con apt; en «Nombres entre redes» todos son Windows (WIN-B2 no está en la zona).

### Fase 47: laboratorios guiados (misiones) y su corrección en el aula (v0.30.0)

Petición: convertir algunos laboratorios en prácticas guiadas con un encargo, tareas, pistas graduadas y una rúbrica; permitir
que el aula compruebe el trabajo o muestre la solución, con esos controles sujetos a las restricciones del profesor.

- **Misiones** (`src/labs/`): basico, relay y nombres-redes. Cada una conserva el laboratorio correspondiente como referencia,
  define el estado inicial incompleto o los cambios de la solución, tareas, rúbrica, pistas y textos en es/en.
- **Panel de misión** (`src/ui/mission-panel.ts`): aparece junto al espacio de trabajo al abrir una misión. Permite leer pistas
  por niveles, comprobar la configuración con la rúbrica y cargar el laboratorio resuelto tras confirmarlo. Guarda en la topología
  las pistas consultadas y si se mostró la solución; la evaluación incluye esos datos.
- **Aula** (`src/classroom/restrictions.ts`, `checklist.ts`, `evaluate.ts`; `docs/EMBED.md`): restricciones independientes para
  comprobar misiones, ver pistas y cargar la solución. La evaluación de una topología informa del id de misión, el número de
  pistas consultadas y si se mostró la solución.
- **Documentación y pruebas:** páginas de ayuda para las misiones, pruebas de estado, construcción y rúbricas; recorrido E2E
  de una misión y de las restricciones del aula.
- **Hecho (v0.30.0)**: basico y relay parten con configuración por completar; nombres-redes parte con el registro DNS de WIN-B2
  ausente. La comprobación puntúa la rúbrica, y «Ver solución» reemplaza la red por la configuración resuelta y deja constancia
  de ello en la topología.

### Fase 48: las misiones, solo si se activan en la configuración general (v0.31.0)

Petición: para ver las misiones de los laboratorios hay que activarlas en Configuración → Generales; por defecto,
desactivadas.

- **Preferencia** `netfix:missions` en `src/ui/preferences.ts` (`missionsShown`, `setMissionsShown`, `onMissionsShown`),
  desactivada si no se marca, guardada en el navegador como el prompt con hora.
- **Qué oculta:** el panel Misión (aunque el laboratorio tenga misión; el estado de la misión se sigue guardando en la
  topología) y el grupo Laboratorios de la Ayuda, también en la búsqueda; al cargar el laboratorio, la barra de estado
  muestra su resumen en vez del aviso de misión. Al cambiar la casilla, el panel y la Ayuda se redibujan al momento.
- **Aula (incrustado):** las misiones se muestran siempre; sus restricciones (`missionCheck`, `hints`, `solution`)
  deciden qué ofrece el panel. No se toca el almacenamiento de la página anfitriona.
- **Pruebas:** preferencia por defecto y avisos (unidad); e2e de misiones: oculto por defecto, sin grupo en la Ayuda,
  casilla en Configuración, panel y grupo al activarla, y se conserva al recargar. Ayuda de Configuración (es/en).
- **Hecho (v0.31.0)**, con la revisión: en el aula la preferencia no escribe nunca en el almacenamiento aunque antes se
  arrancara la aplicación sola en la misma página (`classroomMissions`); el panel y la Ayuda dejan de escuchar la
  opción al reconstruir la interfaz (cambio de idioma). Con las misiones ocultas, el estado de la misión del
  laboratorio se crea y guarda igual, de modo que al activarlas el panel aparece con su progreso.

### Fase 49: named-checkconf, named-checkzone y kea-dhcp4 -t en las terminales GNU/Linux (v0.32.0)

Petición: en las terminales GNU/Linux, las órdenes «named-checkconf», «named-checkzone» y «kea-dhcp4 -t» (y
similares), disponibles al instalar «bind9utils» e «isc-kea» con apt.

- **Paquetes** (`src/shells/apt-catalog.ts`): `bind9-utils` (con `bind9-libs`), `bind9utils` (de transición, trae
  `bind9-utils`) e `isc-kea` (el paquete de ISC; en Ubuntu real viene del repositorio de ISC en Cloudsmith, aquí del
  catálogo ficticio). Son herramientas, sin panel: se guardan en el registro de paquetes del equipo y valen también en
  un PC. `bind9` y `bind9utils` dejan `bind9-utils` instalado (`TRACKED_DEPS`), como apt.
- **Cuándo están:** las de BIND con `bind9-utils` instalado o con `bind9` (también si el panel DNS se activó desde la
  interfaz); `kea-dhcp4` con `isc-kea` o con `kea-dhcp4-server`/`kea`. Sin ellos, el aviso de Ubuntu «Command '…' not
  found, but can be installed with:» y estado 127.
- **named-checkzone ZONA FICHERO** (`src/services/zone-parse.ts`, `zone-check.ts`): lee el fichero maestro
  (`$TTL`, `$ORIGIN`, paréntesis, dueño heredado, TTL y clase en cualquier orden) y da los mensajes de BIND: `zone
  Z/IN: loaded serial N` y `OK`; errores `dns_master_load:`/`dns_rdata_fromtext: FICHERO:LÍNEA: …` (tipo desconocido,
  dirección mal escrita, CNAME con otros datos, SOA fuera del vértice), `has 0 SOA records`, `has no NS records`,
  `NS '…' has no address records (A or AAAA)` y `not loaded due to errors.`; avisos de datos fuera de la zona y de TTL
  ausente. `-q` calla. **named-compilezone -o SALIDA** escribe la zona en forma canónica (nombres completos).
- **named-checkconf [-z] [FICHERO]** (`src/services/named-conf-parse.ts`, `named-conf-check.ts`): sigue los `include`,
  conoce las sentencias y opciones habituales (todas las que genera Netfix) y da los errores de BIND con
  fichero:línea (`missing ';' before`, `unknown option`, `boolean expected`, `expected IP address`, `undefined ACL`,
  `unexpected end of input`, fichero no encontrado) y los de las zonas (`type not present`, `missing 'file' entry`,
  zona repetida). `-z` carga las zonas primarias como named-checkzone. Se añaden `db.local` y `db.127` de Ubuntu.
- **kea-dhcp4 -t|-T FICHERO** (`src/services/kea-json.ts`, `kea-check.ts`): JSON con comentarios de Kea, errores de
  sintaxis al estilo bison (`FICHERO:L.C: syntax error, unexpected …, expecting …`), claves desconocidas (`got
  unexpected keyword "…" in Dhcp4 map.`), tipos, subredes, pools y reservas fuera de su subred; al pasar, las líneas
  INFO de cada subred. `-v`/`-V` dan la versión; sin `-t` muestra el uso.
- **Pruebas:** analizadores (unidad), órdenes en PC y Server (sin instalar, tras instalar, panel activado desde la
  interfaz, usuario sin privilegios, estados), persistencia y regresión: la configuración que genera Netfix en los
  laboratorios pasa `named-checkconf -z` y `kea-dhcp4 -t`. Ayuda de las órdenes y de apt (es/en).
- **Hecho (v0.32.0)**, con la revisión: los ficheros de zona admiten `$GENERATE` (rango con paso, `${desplazamiento,
  ancho,base}`) y `$INCLUDE` (relativo al directorio de trabajo de named o al de `-w`), los tipos que BIND conoce sin
  mirarlos por dentro (DNSSEC, SSHFP, TLSA, DNAME, `TYPEnnn`…) y un índice por dueño en vez de recorrer la zona en cada
  registro. named.conf acepta muchas más opciones de BIND 9.20 (una errata sigue siendo `unknown option`), un `/*` sin
  cerrar es `unexpected end of input` y `named-checkconf -l` lista las zonas; Kea, los parámetros DDNS que faltaban y el
  resto de opciones estándar de DHCPv4. Límites contra ficheros hostiles: el patrón del TTL ya no retrocede
  exponencialmente, la anidación de JSON (`memory exhausted`) y de listas de direcciones está acotada, como el total de
  `include`; un error inesperado al leer un fichero no se escapa, y una ruta ocupada no detiene apt al dejar los
  ficheros por defecto en un PC.

### Fase 50: apt autoremove, nmblookup, resolvectl, Samba como servidor de ficheros y Servicios de un PC GNU/Linux (v0.33.0)

Petición: (1) `apt autoremove` no quitaba nmblookup; (2) `nmblookup localhost` no resolvía `localhost<00>` en
GNU/Linux; (3) al instalar samba debe aparecer su panel de gestión en Servicios, y un PC GNU/Linux debe tener en
Servicios al menos los parámetros del kernel y, con nftables o samba instalados por apt, la pestaña del servicio, la de
configuración y la de registros, que desaparecen al desinstalarlos (un PC no tiene gestión web: no tiene servidor
HTTP); (4) `resolvectl` mostraba mDNS y LLMNR sin tenerlos instalados; (5) laboratorio de compartición de ficheros con
Samba en un servidor GNU/Linux; (6) documentación al día.

- **apt autoremove** (`src/shells/apt-auto.ts`): las dependencias que apt instala solas se marcan
  automáticas (como en `/var/lib/apt/extended_states`; `apt list --installed` dice `[installed,automatic]`); `apt remove` avisa de las que ya nadie necesita («no longer
  required») y `apt autoremove [--purge]` las quita, como apt real. Tras `apt remove samba` se va samba-common-bin y,
  con él, `nmblookup`.
- **nmblookup** (`src/shells/nmblookup.ts`): `localhost` responde 127.0.0.1 y el nombre propio, la dirección del
  equipo, mientras nmbd está en marcha. NetBIOS (`src/net/netbios.ts`) exige nmbd en marcha para responder y smbd para
  servir SMB.
- **resolvectl** (`src/shells/resolvectl.ts`): solo los protocolos instalados. `+mDNS` y el ámbito `mDNS/IPv4` (en
  las interfaces con dirección) con avahi-daemon o libnss-mdns; LLMNR nunca, porque ningún paquete lo trae aquí.
- **Samba servidor de ficheros**: `smb.conf` (`src/services/smb-conf.ts`: secciones, `path`, `read only`, `guest ok`,
  `valid users`, `browseable`), cuentas (`smb-passdb.ts`, `smbpasswd -a/-x/-d/-e/-s`), servidor SMB (`smb-server.ts`,
  aplica los permisos Linux de la cuenta o de nobody), `testparm`, `smbclient` (paquete nuevo: `-L`, `-N`, `-U`, `-c`,
  ls/cd/get/put/mkdir/rmdir/rm) y, en Windows, `net view \\srv` y `net use Z: \\srv\recurso` con `dir`, `copy` y
  `type` en la unidad. `chown`/`chgrp` aceptan los grupos del sistema (`users`, `nogroup`…).
- **Servicios** (`src/net/pkg-units.ts` → `hostPanels`): en un Server o router GNU/Linux, samba añade el panel
  **Samba** (`src/ui/samba-panel.ts`: smbd/nmbd encendido o apagado, recursos y cuentas, mediante
  `src/shells/samba-admin.ts`), y smbd y nmbd entran en Registros. Un PC GNU/Linux tiene la pestaña Servicios
  (`src/ui/pc-services.ts`) con Parámetros siempre; nftables añade Firewall, samba añade Samba y cualquiera de los dos,
  Configuración y Registros (`src/ui/log-panel.ts`, compartido con el servidor). apt redibuja la ventana al instalar o
  quitar. Un PC Windows sigue sin esta pestaña.
- **Laboratorio** «Compartir carpetas con Samba en un servidor GNU/Linux» (`src/net/labs-samba.ts`): SRV comparte
  `publico` (invitados) y `profes` (`valid users = ana luis`, solo ana con cuenta); PC0 (Windows) y PC1 (GNU/Linux) los
  usan.
- **Pruebas:** samba (smb.conf, cuentas, servidor, smbclient, net use), apt autoremove, nmblookup localhost,
  resolvectl con y sin avahi, `hostPanels` y unidades de los paquetes; e2e `scripts/e2e-samba.mjs` (Servicios del PC
  con apt install/remove y el panel Samba de SRV). Ayuda de las órdenes, de apt y de la resolución de nombres (es/en).
- **Hecho (v0.33.0).** Límites conocidos: el acceso de invitados funciona aunque Windows real bloquea por defecto los
  inicios de sesión de invitado inseguros; `systemctl is-active` con varias unidades sigue dando solo la primera.

### Fase 51: detalles de SMB (v0.33.1)

Tres fallos menores de la revisión de la fase 50, con sus pruebas en `tests/services/samba.test.ts`:

- **Conectar a un recurso** (`src/services/smb-server.ts`, `connect`): como smbd, basta poder entrar en la carpeta
  (permiso x, además del de los directorios del camino); leerla (r) solo hace falta para listarla. Un buzón en modo 733
  conecta y admite `put`, y `ls` da `NT_STATUS_ACCESS_DENIED listing \*`.
- **Enlaces que salen del recurso**: borrar o renombrar actúa sobre el enlace y no sobre su destino, así que solo se
  comprueban los directorios del camino (`resolve(…, follow = false)`); leer, escribir o listar a través del enlace
  sigue denegado. Renombrar sobre un enlace a un directorio movería el archivo dentro de él: ese directorio también
  tiene que estar en el recurso (`renameTarget`).
- **smbclient**: `ls` y `rm` con comodines (`*`, `?`; sin distinguir mayúsculas, como el servidor) filtran el
  directorio y, sin coincidencias, dan `NT_STATUS_NO_SUCH_FILE`; `rm` con máscara no borra directorios. `-c` sigue
  separando en cada `;`, también entre comillas: es lo que hace smbclient (`process_command_string`), no un fallo.
- **Hecho (v0.33.1).**

### Fase 52: Samba en la configuración del laboratorio y de cada equipo; unidades de red navegables (v0.34.0)

- **Laboratorio** (Configuración → Laboratorio actual): casilla «Permitir instalación de Samba», activada por defecto y
  guardada con la topología solo cuando está desactivada (`sambaOff`). Desactivada, `apt install samba` responde
  `Error: Unable to locate package samba` (exit 100) y desaparecen la casilla, el panel y la página web de Samba; lo
  instalado se queda.
- **Equipo** (pestaña Configuración de un PC, Server o router GNU/Linux con sistema GNU/Linux): casilla **Samba** en
  Servicios, marcada si el paquete samba está instalado; marcarla o desmarcarla instala o quita samba como lo hace apt
  (dependencias automáticas, smb.conf, smbd y nmbd en marcha).
- **nmblookup** ya no responde `localhost` (Windows tampoco lo hace): solo el nombre propio con nmbd en marcha.
- **Gestión web** de Server y router GNU/Linux: página **Samba** en Servicios (smbd/nmbd, recursos, cuentas), con el
  mismo código que el panel (`src/shells/samba-admin.ts`).
- **Windows**: una unidad de `net use` se usa como C:. `Z:` cambia de unidad (cada una con su carpeta actual), `cd`,
  `cd ..`, `cd \`, `cd /d`, `dir` sin ruta, rutas relativas en dir, type, md, rd, del, ren, copy y move, redirección
  `>`/`>>` a la unidad y el prompt `Z:\carpeta>`. `cd Z:` y `cd C:` muestran la carpeta de esa unidad;
  una ruta UNC no puede ser la carpeta actual. Si la unidad se desconecta, la terminal vuelve a C: (`src/shells/win-drives.ts`).
- **Servicios → Configuración**: el origen «Parámetros (sysctl)» aparece en todo equipo con terminal GNU/Linux que tiene
  Servicios → Parámetros. En un PC GNU/Linux, Configuración aparece siempre; Registros solo con nftables o samba.
- **Pruebas** (`tests/services/samba-settings.test.ts`, `tests/shells/win-drives.test.ts`): permiso del laboratorio,
  casilla del equipo, nmblookup, página web y unidades; se actualizan las de `hostPanels`, `configSources` y netbios.
- **Hecho (v0.34.0)**, con la revisión: en una unidad de red `md` y `type` toman todos los nombres (como en C:); `edit`
  con un nombre relativo en Z: no abre un archivo de C:; una letra que se vuelve a conectar a otro recurso empieza en su
  raíz; una ruta de recurso que pasa por un archivo da el error de ruta en vez de una excepción; borrar un recurso solo
  borra recursos (no `[global]`). `cd nada\..` funciona como en Windows (que resuelve `..` sobre el texto).

### Fase 53: Samba como servicio de cada tipo de equipo, smbclient por NetBIOS y ayuda de Samba (v0.35.0)

Petición: (1) en el laboratorio Samba, `net use //srv/publico Z:` y después `Z:` no cambia de unidad; (2) desde PC1,
`smbclient //srv/publico` da `do_connect: Connection to srv failed (Error NT_STATUS_UNSUCCESSFUL)` aunque en SRV
funciona; (3) Samba, servicio integrado de servidores, routers GNU/Linux y PCs, desactivado en cada equipo y activado
(desactivable) en la configuración del laboratorio; apt install/remove de un servicio marca o desmarca su casilla y
hace aparecer o desaparecer sus pestañas en Servicios y en la gestión web; (4) ayuda exhaustiva de Samba al nivel de
DNS y ayuda de apt reformulada.

- **(1) No es un fallo de Netfix, es la sintaxis de Windows:** `net use` pide `net use Z: \\srv\publico` (letra
  primero, barras invertidas). Con `//srv/publico Z:` muestra su ayuda y no conecta nada, así que `Z:` responde «The
  system cannot find the drive specified.»; con `\\srv\publico Z:` conecta sin letra (Z: es la contraseña), como
  Windows. Se documenta en «Samba: acceder desde Windows y GNU/Linux».
- **(2) Fallo de Netfix:** smbclient resolvía como glibc (nsswitch.conf, sin `wins`), pero Samba usa su propio
  `name resolve order = lmhosts wins host bcast`: tras el sistema, un broadcast NetBIOS que responde el nmbd del
  servidor. `src/shells/smbclient.ts` lo hace ahora para nombres de una etiqueta (≤ 15 caracteres); sin nmbd en el
  servidor, o con un nombre con puntos que el DNS no conoce, sigue dando NT_STATUS_UNSUCCESSFUL, como el real.
- **(3) Samba, función del laboratorio por tipo:** `samba` en `FEATURES_BY_KIND` de PC, Servidor y Router GNU/Linux
  (activada por defecto; casilla «Servicio Samba (compartir ficheros)» de cada tipo). Sustituye a la casilla única
  «Permitir instalación de Samba» (`allowSamba`); un archivo de la v0.34 con `sambaOff` desactiva Samba en los tres
  tipos. En cada equipo la casilla Samba sigue al paquete (desmarcada hasta instalarlo). Una prueba recorre todos los
  paquetes de servicio (openssh-server, kea, bind9, apache2, postfix, nftables, samba): apt install marca la casilla y
  activa el panel y la página web; apt remove los quita (la página queda en gris, u oculta con la opción del laboratorio).
- **(4) Ayuda:** Servidor → Samba: «Samba: compartir carpetas» (activarlo, smbd y nmbd, smb.conf, cuentas, dos capas
  de permisos, panel y gestión web, ejercicio) y «Samba: acceder desde Windows y GNU/Linux» (resolución de nombres de
  cada cliente, net use y sus trampas, smbclient, tabla de errores, ejercicio), es/en. apt: Samba en la tabla de
  servicios, casilla y paquete siempre a la par, lo detallado pasa a las páginas de Samba. Configuración: Samba en las
  tablas.
- **Hecho (v0.35.0)**, con la revisión: las listas de `features` se guardan con `featuresV: 2`; una lista sin esa marca
  (guardada antes de la v0.35, que nunca nombra Samba) deja Samba activado en vez de desactivarlo sin querer, y
  `sambaOff` sigue desactivándolo. smbclient pregunta por NOMBRE<20> (el servicio de ficheros), como el real.

### Fase 54: resolución de nombres en GNU/Linux con systemd-resolved (DNS, LLMNR, mDNS), NSS y WINS (v0.36.0)

Petición: que la terminal GNU/Linux resuelva nombres con systemd-resolved (DNS, mDNS y LLMNR) y con NetBIOS, integrado
en NSS y con WINS; documentarlo en la Ayuda y comprobar que funciona con `resolvectl`.

Objetivo: GNU/Linux deja de ser «el que no habla LLMNR». systemd-resolved pasa a ser una unidad real, con su
`/etc/systemd/resolved.conf`, sus ámbitos por interfaz (DNS, LLMNR/IPv4, mDNS/IPv4) y su fuente NSS `resolve`
(libnss-resolve). NetBIOS gana un servidor WINS de verdad (nmbd con `wins support = yes`), y lo usan tanto los
clientes GNU/Linux (`wins server =`) como los Windows (TCP/IP → WINS, `ipconfig /all`, nodo h).

Decisiones del usuario (no se reabren):
- **Herramientas**: `resolvectl` comprueba DNS, mDNS y LLMNR, nunca NetBIOS, como en Ubuntu. La orden nueva
  `getent hosts|ahosts NOMBRE` sigue toda la línea `hosts:` de nsswitch, `wins` incluido. `nmblookup` gana
  `-U servidor` y `-R` para consultar NetBIOS y WINS.
- **WINS completo**:
  - nmbd con `wins support = yes` hace de servidor y guarda los registros.
  - Un cliente GNU/Linux con `wins server = IP` pregunta por unicast, que cruza routers, y por difusión si falla.
  - Un cliente Windows tiene su WINS en la pestaña TCP/IP, `ipconfig /all` lo muestra, y NetBT se registra y
    pregunta al WINS antes de la difusión (nodo h).
- **LLMNR y mDNS empiezan apagados**, como en Ubuntu (`-LLMNR -mDNS`). Se encienden de dos maneras:
  - `LLMNR=yes` / `MulticastDNS=yes` en resolved.conf y `systemctl restart systemd-resolved`;
  - `resolvectl llmnr|mdns eth0 yes`.

  Un GNU/Linux con LLMNR responde por su nombre. `resolvectl query pc2` dice
  `-- Information acquired via protocol LLMNR/IPv4 in …`, y un nombre `.local` dice `mDNS/IPv4`.

**Por decidir o contrastar en una VM Ubuntu real antes del commit 4:**
1. **Global frente a enlace.**
   - En resolved real, el soporte de cada enlace es el MÍNIMO entre el valor global y el del enlace. mDNS necesita
     los dos en yes. Por defecto el enlace tiene LLMNR=yes y mDNS=no.
   - La salida típica sería:
     - global: `-LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported`;
     - enlace: `+DefaultRoute +LLMNR -mDNS …` con `Current Scopes: DNS` (confianza ~70 %).
   - **Decidido (usuario): MIN(global, enlace)**, como resolved real, aislado en `effectiveSupport()` para poder
     cambiarlo con una línea.
2. `nmblookup -R` sin `-U` sigue preguntando por difusión, aunque haya `wins server` (~80 %). Al WINS se pregunta
   con `nmblookup -U IP -R nombre`.
3. La versión de systemd no cuadra: el catálogo trae `258.1-1ubuntu1` y los comentarios de resolvectl dicen 257.
   Se unifica, y libnss-resolve lleva la versión de systemd.
4. resolvectl ya no muestra `+mDNS` por tener avahi: solo depende de resolved. Se reescribe el caso de la fase 50
   en `tests/shells/resolvectl.test.ts`. avahi sigue resolviendo `.local` por NSS (`mdns4_minimal`).

#### Modelo

- **resolved.conf**:
  - `host-system.ts` siembra el fichero de Ubuntu, con `[Resolve]`, `#LLMNR=no` y `#MulticastDNS=no`.
  - Lo lee `src/shells/resolved-conf.ts`, como fichero no fiable: límites de tamaño y de líneas, solo `[Resolve]`,
    valores `yes|no|resolve` (también true/false/1/0); lo demás se ignora.
  - Solo se lee al arrancar o reiniciar la unidad, o al cargar. El resultado queda en `resolved.ts`
    (`resolvedConfig` en un WeakMap). Editar sin reiniciar no cambia nada.
- **Por enlace**: `resolvectl llmnr|mdns LINK [yes|no|resolve]`.
  - Cambiarlo exige root; sin valor, muestra `Link 2 (eth0): no`.
  - Se guarda en los overrides de `resolved.ts`. `revert` o un cambio de IP lo quitan, como pasa ya con dns/domain.
  - No se guarda en la topología.
- **Soporte efectivo**: `effectiveSupport(host, link, 'llmnr'|'mdns')`, con el orden no < resolve < yes. `resolve`
  solo pregunta; `yes` pregunta y responde.
- **Unidad `systemd-resolved`** en `PKG_UNITS`:
  - campos nuevos `base: true` (siempre instalada) y `path` (`/usr/lib/systemd/systemd-resolved` en
    `systemctl status`);
  - en el journal, `Positive Trust Anchors:` … y `Using system hostname '…'.` (función `startLines(u)`);
  - no entra en Registros salvo que se decida; los ficheros antiguos sin `units` deben cargar igual.
- **Resolved parado**: la fuente `resolve` da UNAVAIL y glibc pasa a `dns`; los respondedores LLMNR y mDNS de Linux
  callan. No se simula el stub 127.0.0.53.
- **libnss-resolve**:
  - Paquete nuevo con la versión de systemd. Su postinst llama a `withResolve(text, on)` de `nsswitch.ts`, que pone
    `resolve [!UNAVAIL=return]` antes de `dns` y lo quita al desinstalar (como `withMdns`).
  - Ubuntu Server y Desktop no lo traen de serie (~85 %). Sin él, `ping pc2` y `getent hosts pc2` no usan LLMNR
    aunque `resolvectl query pc2` sí. Es la lección central del laboratorio.
- **Semántica de `resolve`** (nuevo `src/shells/nss-resolve.ts`, común a `resolvectl query` y a NSS):
  - primero lo sintético: localhost, el nombre propio, `_gateway`;
  - `.local`: mDNS si hay ámbito; si no, `No appropriate name servers or networks for name found`;
  - un nombre de una etiqueta: DNS (solo con dominios de búsqueda) y LLMNR en paralelo;
  - lo demás: DNS;
  - el resultado lleva el protocolo: `DNS`, `LLMNR/IPv4` o `mDNS/IPv4`.
- **Acciones de nsswitch**:
  - `hostsSources()` devuelve las acciones (`{status, negate, action}`); `notFoundReturn` se mantiene, derivado.
  - Con `resolve [!UNAVAIL=return] dns wins` y resolved en marcha, `wins` no llega a preguntarse. Hay que explicarlo
    en la documentación.
- **Respondedores de Linux**:
  - `registerLinuxLlmnr(pred)` y `registerLinuxMdns(pred)`; `topology.ts` les pasa los predicados desde
    `shells/resolved.ts`, así que net/ no importa shells/.
  - Con `resolve`, el equipo pregunta pero no responde.
- **WINS** (nuevo `src/net/wins.ts`, sin imports de shells):
  - **Base por servidor**: guarda sufijo, grupo, IPs y caducidad, con un TTL de 6 días (`max wins ttl`, por
    verificar) y un máximo de entradas.
  - **Rol de servidor**: `setWinsServer(host, on)`, que llama pkg-service al arrancar o recargar nmbd.
  - **Operaciones**: registro, refresco, liberación y consulta unicast con RD; si el nombre no está, NAM_ERR
    (rcode 3).
  - **Enganche en netbios.ts**: `take()` entrega el unicast a `registerWinsHandler(fn)`.
  - **Cliente Linux**: `winsServersOf(host)` lee smb.conf en cada consulta; se registra al arrancar nmbd con
    `wins server`.
  - **Cliente Windows**: `setWindowsWins` / `windowsWins` en un registro débil, fuera de host.ts. Se registra al poner
    el WINS, cuando cambia la IP (solo entonces, para evitar tormentas) y al cargar.
- **smb.conf**: claves `wins support` y `wins server` (IPs separadas por espacios o comas; las que no son IP se
  descartan).
  - Si están las dos, testparm da
    `ERROR: both 'wins support = true' and 'wins server = <server list>' cannot be set in the smb.conf file. nmbd will abort with this setting.`
    (~75 %), y nmbd no arranca.
- **Windows** (`windowsLinkResolve`): con WINS, primero la consulta unicast al WINS; si falla, LLMNR y la difusión en
  paralelo, como ahora.
- **DHCP opción 44**: solo para pools IOS, cuyo servidor ya la envía (`dhcp/server.ts:358`).
  - **Ojo**: `src/dhcp/client.ts` todavía no la lee. Hay que añadir `winsServers` al `Lease`.
  - Windows usa el WINS manual o, si no lo hay, el del lease.

#### Salida literal (punto de partida; contrastar en la VM)

- `resolvectl status`, global:
  ```
  Global
           Protocols: -LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported
    resolv.conf mode: stub
  ```
- `resolvectl status`, enlace por defecto:
  ```
  Link 2 (eth0)
      Current Scopes: DNS
           Protocols: +DefaultRoute +LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported
  ```
  Con todo encendido: `Current Scopes: DNS LLMNR/IPv4 mDNS/IPv4`.
- `resolvectl query pc2`: `pc2: 192.168.1.12` y `-- link: eth0`, seguido de
  `-- Information acquired via protocol LLMNR/IPv4 in 1.2ms.`. El protocolo deja de estar fijo en
  `resolvectl-query.ts`.
- `resolvectl llmnr eth0` muestra `Link 2 (eth0): no`. Sin root:
  `Failed to set LLMNR support: Interactive authentication required.`
- `getent hosts pc2`:
  - salida `192.168.1.12    pc2`, con formato `%-15s %s`;
  - exit 0; si no lo encuentra, nada y exit 2;
  - `getent foo x` da `Unknown database: foo` y exit 1;
  - una IP como clave hace la búsqueda inversa.
- `getent ahosts pc2`: líneas STREAM / DGRAM / RAW con formato `%-15s %-6s %s` (las dos últimas acaban en espacio).
- `nmblookup -U 192.168.1.10 -R pc2`:
  - primero `querying pc2 on 192.168.1.10`, después `192.168.1.12 pc2<00>`;
  - si falla, `name_query failed to find name pc2`.
- `ipconfig /all`: `   Primary WINS Server.............: 192.168.1.10`, solo si hay WINS.
- Simulación (`nbnsFields`): filas Opcode, RD, TTL y Rcode, con claves `pdu.*` nuevas en es y en.

#### División de ficheros y ciclos

- `src/net/topology.ts` (398 líneas): primero se extrae `hostRecord`/`restore` a `src/net/topology-host.ts`, en un
  commit `refactor:`. Allí va el campo `wins?`, validado como IP.
- `src/shells/net-tools.ts`: `linuxLookup` sale a `src/shells/nss-hosts.ts`, que usan `resolveHost` y getent.
- `src/shells/resolvectl.ts`: los verbos `llmnr` y `mdns` van a `src/shells/resolvectl-link.ts`.
- `src/shells/getent.ts`: orden nueva, registrada en `linux-programs.ts`.
- `src/net/netbios.ts`: solo cambian el enganche WINS en `take()` y el RD en `nbnsQuery`.
- `host.ts` (398 líneas) no se toca.
- Los imports van de shells a net y de net a core. Los predicados de shells llegan a net por registros que se
  rellenan desde topology.ts.

#### Commits (TDD: prueba en rojo primero; `npm run check` en verde en cada uno)

1. `refactor:` extrae el registro de host de topology.ts. Las pruebas de topología quedan en verde sin cambios.
2. Acciones de nsswitch y libnss-resolve (`nsswitch.ts`, `apt-catalog.ts`, `apt-scripts.ts`). Pruebas:
   - al instalar, `files resolve [!UNAVAIL=return] dns`, y con mdns delante;
   - al desinstalar se quita;
   - un fichero editado a mano conserva lo demás;
   - `[!UNAVAIL=return]` se aplica bien.
3. resolved.conf y la unidad systemd-resolved. Pruebas:
   - `systemctl status` con `Network Name Resolution`;
   - editar sin restart no cambia nada; con restart, sí;
   - ficheros raros (10 000 líneas, valores inválidos);
   - stop y start.
4. resolvectl muestra y cambia LLMNR y mDNS. Se reescribe el caso «LLMNR nunca». Pruebas:
   - los valores por defecto;
   - el valor global con restart;
   - el valor por enlace según la decisión 1;
   - sin root;
   - `revert`.
5. LLMNR y mDNS de resolved por la red. Pruebas:
   - WIN1 encuentra a LNX1 por LLMNR;
   - `resolvectl query` muestra `LLMNR/IPv4` y `mDNS/IPv4`;
   - `resolve` no responde;
   - resolved parado no responde;
   - el TTL 1 no cruza el router.
6. `getent hosts` y `ahosts`, con su entrada en `src/docs/utils.ts`. Pruebas:
   - las fuentes files, dns y resolve; esta última solo con libnss-resolve;
   - `ping` falla sin libnss-resolve aunque resolvectl funcione;
   - `wins` no se alcanza detrás de `resolve` mientras resolved está en marcha, y sí cuando está parado;
   - los códigos de salida y una IP como clave.
7. smb.conf con `wins support` y `wins server`. Pruebas: el análisis de las IPs, el error de testparm y que nmbd no
   arranca con las dos claves.
8. Servidor WINS en nmbd. Pruebas:
   - registro al arrancar;
   - consulta unicast desde otra subred, a través del router;
   - NAM_ERR;
   - liberación al parar;
   - refresco y caducidad con el reloj simulado;
   - límite de entradas.
9. `nmblookup -U` y `-R`, y la fuente NSS `wins` pregunta primero al WINS y luego por difusión. Se actualiza el uso
   de `-h`.
10. WINS en Windows (`win-names.ts`, `windows.ts`, `ui/host-ip.ts`, `topology-host.ts`, `dhcp/client.ts`). Pruebas:
    - `Primary WINS Server` en `ipconfig /all`;
    - `ping` entre redes por WINS;
    - la opción 44 de IOS llega al WINS;
    - guardar y cargar, rechazando lo que no es IP;
    - el campo de la UI, escapado.
11. PDU NBNS con opcode, RD, TTL y rcode en Simulación, con i18n es/en.
12. `docs:`, la resolución en GNU/Linux (`names.ts` es/en, `utils.ts` es/en, `apt.ts`):
    - tabla de fuentes NSS con `resolve`;
    - global frente a enlace y el restart;
    - qué ve cada herramienta (resolvectl, getent, nmblookup);
    - WINS y el nodo h.
13. Laboratorio «Nombres con systemd-resolved y WINS» (nuevo `src/net/labs-resolved.ts`). Topología: dos LAN con
    router, SRV-WINS, LNX-A, LNX-B, WIN-A y WIN-B. Ejercicios:
    - encender LLMNR y comprobarlo con resolvectl;
    - ver que ping no lo usa hasta instalar libnss-resolve;
    - poner `wins server` y comprobarlo con `nmblookup -U … -R` y `getent`;
    - configurar el WINS de WIN-B y comprobarlo con `ipconfig /all`.
14. `test:` e2e (`scripts/e2e-names.mjs`): resolved.conf con nano y restart, `resolvectl status`, getent, nmblookup,
    el WINS en la UI y las filas de Simulación. Se ajustan `e2e-dns.mjs` y `e2e-docs.mjs` si comprueban textos viejos.
15. `chore: v0.36.0`: la versión, about-data y PLAN.md.

`security-reviewer` (opus) revisa los commits 3, 7, 8 y 10. La cobertura debe ser ≥ 80 % en `wins.ts`,
`resolved-conf.ts`, `nss-resolve.ts`, `nss-hosts.ts` y `getent.ts`.

**Seguridad**:
- resolved.conf, smb.conf, nsswitch.conf y las topologías cargadas no son fiables. Llevan límites de tamaño, líneas
  y entradas, valores de una lista blanca, regex sin backtracking catastrófico y IPs pasadas por `parseIp`.
- La base WINS tiene un máximo de entradas y un TTL acotado.
- Los nombres NetBIOS siguen limitados a 15 caracteres.
- El campo WINS y los nombres registrados se muestran con `textContent`.

**Riesgos**:
- La fidelidad de las salidas; se mitiga contrastando en la VM.
- `hostsSources` afecta a todas las búsquedas de Linux; las pruebas de ping, curl y ssh por nombre deben seguir en
  verde.
- La unidad base en `hostPanels`, `journalUnits` y `pkgUnitsRecord`.
- Las tormentas de registro de Windows.
- Los tamaños: topology.ts y host.ts.

**Límites** (para fases posteriores):
- sin el stub 127.0.0.53 ni la reactivación por D-Bus;
- sin DNSSEC, DoT ni `resolvectl monitor`;
- WINS sin conflictos, challenge, `wins.dat`, `wins proxy` ni `name resolve order`;
- sin replicación de WINS ni `netsh … winsservers`;
- sin opción 44 en Kea ni en el DHCP de PT;
- sin IPv6.

- **Hecho (v0.36.0)**, con la revisión de seguridad: el servidor WINS acota el TTL a [6 h, 6 días], guarda como mucho
  512 registros (después responde RFS_ERR) y solo atiende consultas unicast con RD; Windows refresca a la mitad del TTL
  concedido con un único temporizador por equipo y usa como mucho dos servidores WINS de la concesión. La vista PDU de
  NBNS (`src/ui/pdu-nbns.ts`) traduce el opcode y el código de respuesta. Laboratorio «Nombres en GNU/Linux:
  systemd-resolved, NSS y WINS» (`src/net/labs-resolved.ts`) y e2e `scripts/e2e-names.mjs`.

### Fase 55: opción 44 en el DHCP de PT y Kea, smbclient con WINS, compartir en Windows y catálogo de paquetes apt (v0.37.0)

Petición: (1) que el DHCP de Kea y el del router IOS envíen la opción 44; (2) que smbclient consulte el servidor WINS;
(3) en los equipos Windows, la casilla «Compartir archivos e impresoras para redes Microsoft» en su Configuración, que
activa Servicios → SMB para gestionar los recursos compartidos por SMB/NetBIOS (sin apt), con su casilla en la
configuración general; (4) en cada equipo, un catálogo de los paquetes apt que no son servicios (network-manager,
smbclient…), con una casilla por paquete que equivale a apt install/remove, y su paralelo en la configuración general.

Estado de partida:
- **IOS ya envía la opción 44** (`netbios-name-server` en `ip dhcp pool`, `src/dhcp/server.ts:358`) y Windows la usa
  desde la Fase 54. Falta en el DHCP de PT (Servidor, Router GNU/Linux y Windows Server: Servicios → DHCP y su gestión
  web), que es el que genera `/etc/kea/kea-dhcp4.conf`.
- smbclient pregunta al sistema y después por difusión; nunca al `wins server` de smb.conf.
- Windows responde por SMB solo con IPC$ (`smb-server.ts`), registra NOMBRE<20> y no tiene Servicios.
- El único paquete con casilla por equipo es samba (`setSambaInstalled`); el resto se instala solo por la terminal.

Decisiones tomadas por defecto (se pueden cambiar al revisar el plan):
1. **Opción 44 en PT**: un campo «Servidor WINS» por pool (opcional, una IP). Va a `netbiosServers` del motor y a
   `{ "name": "netbios-name-servers" }` en kea-dhcp4.conf. Sin opción 46: Windows con WINS y sin tipo de nodo se pone
   en nodo h, como el real.
2. **smbclient**: sigue `name resolve order = lmhosts wins host bcast` de Samba: con `wins server` en smb.conf pregunta
   por unicast a ese WINS (cruza routers) antes que al sistema; sin él, como ahora. `name resolve order` escrito en
   smb.conf se respeta (wins, host, bcast; lmhosts se acepta y no hace nada).
3. **Compartir en Windows, como «uso compartido con protección por contraseña» desactivado**: cada recurso tiene
   nombre, carpeta (C:\…), comentario y permiso para Todos: Lectura o Control total. Se entra sin contraseña (cualquier
   usuario se acepta como invitado); las operaciones corren con la cuenta local del equipo y no salen de la carpeta.
   Netfix no tiene contraseñas de Windows; la protección por contraseña queda para otra fase.
4. **Casilla desactivada = enlace desmarcado en el adaptador, como Windows real**: sin el servicio Servidor no hay
   TCP 139/445 (smbclient: `NT_STATUS_CONNECTION_REFUSED`; `net view \\pc`: `System error 53 has occurred.`) ni
   NOMBRE<20>. Cambia el comportamiento actual (IPC$ siempre); las pruebas y laboratorios que lo usan marcan la casilla.
   En el equipo empieza desmarcada; en el laboratorio, la función empieza activada (como Samba).
5. **`net share`** en la terminal Windows: listar, `net share NOMBRE=C:\ruta [/grant:Everyone,READ|FULL]
   [/remark:"…"]` y `net share NOMBRE /delete`, con la salida literal de Windows. Es lo mismo que el panel.
6. **Catálogo de paquetes**: los paquetes de herramientas de `apt-catalog.ts` (sin `feature` y sin samba):
   network-manager, avahi-daemon, libnss-mdns, libnss-resolve, smbclient, samba-common-bin, winbind, libnss-winbind y
   bind9-utils (bind9utils, nombre viejo, se queda solo para la terminal). Solo en equipos con lado GNU/Linux. La
   casilla hace lo mismo que `apt install`/`apt remove` (dependencias automáticas, postinst, unidades, dpkg.log), sin
   pedir red, como la de Samba; la terminal y la casilla se siguen mutuamente.
7. **En la configuración general, disponibilidad**: una casilla por paquete del catálogo en «Laboratorio actual»,
   común a todos los tipos, activadas por defecto. Desactivada: el paquete desaparece del catálogo de los equipos y
   `apt install` responde `E: Unable to locate package X`, como un repositorio quitado. Un equipo que ya lo tiene lo
   conserva (y puede quitarlo con apt remove). Se guarda como lista de desactivados.

Commits (TDD, uno o varios por punto):
1. `docs:` este plan.
2. `feat:` opción 44 en el DHCP de PT: `PtDhcpPool.wins`, `validatePool`, `persist.ts` (IP validada), `ptPoolToIos`,
   `keaConf`, campo en Servicios → DHCP (`server-dhcp-dns.ts`) y en la gestión web (`admin-pages.ts`,
   `admin-actions.ts`), i18n es/en. Pruebas: un Windows con DHCP de un Servidor ve el WINS en `ipconfig /all` y se
   registra; kea-dhcp4.conf lo lleva y pasa `kea-dhcp4 -t`; la prueba equivalente con un pool IOS.
3. `feat:` smbclient pregunta al WINS (`winsLookup`) en el orden de Samba; prueba con el laboratorio
   `nombres-resolved` (LNX-B llega a //win-a a través del router solo con `wins server`).
4. `refactor:` el núcleo de apt install/remove (`apt.ts`) en una función común; `setAptInstalled(host, nombre, on)` y
   `setSambaInstalled` como envoltorio. Las pruebas de apt y Samba siguen en verde.
5. `feat:` catálogo por equipo (Configuración → «Paquetes») y disponibilidad en el laboratorio (`lab-features.ts`:
   `pkgsOff`, validado con la regex de nombres y `MAX_LIST`; `settings-view.ts`); apt install de un paquete quitado da
   «Unable to locate package». Persistencia y lectura de archivos viejos (sin la lista = todo disponible).
6. `feat:` compartir en Windows: función `winshare` del laboratorio (PC y Servidor), casilla por equipo, registro de
   recursos (`src/net/win-shares.ts`, WeakMap + JSON validado: nombre ≤ 80, sin `\/:*?"<>|`, carpeta dentro del VFS,
   máximo de recursos), persistencia.
7. `feat:` el servidor SMB de Windows: `smb-server.ts` separa «qué recursos hay» (smb.conf o el registro de Windows)
   de las operaciones de ficheros; casilla apagada = sin 139/445 y sin NOMBRE<20>; NBSTAT y `nmblookup -S` lo
   reflejan. Clientes: smbclient desde GNU/Linux y `net use`/`dir \\win-a\docs` desde otro Windows.
8. `feat:` Servicios → SMB en Windows (PC y Servidor), con la tabla de recursos y su formulario, y `net share` en la
   terminal (`src/shells/win-net-share.ts`), con su entrada en `src/docs/utils.ts` es/en.
9. `docs:` Ayuda es/en: opción 44 (DHCP), smbclient y WINS (Samba), «Compartir en Windows», catálogo de paquetes (apt y
   Configuración).
10. `test:` e2e `scripts/e2e-winshare.mjs` (puerto 8115): casilla de Windows, recurso en Servicios → SMB, `smbclient`
    desde GNU/Linux; casilla de un paquete del catálogo y su efecto en la terminal; campo WINS del pool. En la cadena
    `npm run e2e`.
11. `chore: v0.37.0`: versión, about-data y PLAN.md.

`security-reviewer` (opus) revisa los commits 5, 6, 7 y 8 (datos de archivos cargados, rutas de los recursos, acceso
fuera de la carpeta, HTML de los paneles).

**Seguridad**:
- Las rutas de los recursos de Windows se resuelven en el VFS y se rechazan `..` y los enlaces que salen de la carpeta,
  como en Samba.
- Las listas cargadas de archivos (recursos, paquetes desactivados) tienen máximo de entradas y validación por regex.
- Los nombres y comentarios de los recursos se muestran con `textContent`.

**Riesgos**:
- Pruebas y laboratorios que dan por hecho que Windows responde por SMB o registra NOMBRE<20>
  (`tests/net/netbios.test.ts`, `tests/services/samba.test.ts`, `labs-resolved`).
- El tamaño de `smb-server.ts`, `apt.ts`, `settings-view.ts` y `device-config.ts`.
- Que casilla y terminal no se desincronicen (ambas pasan por la misma función de apt).

**Límites** (para fases posteriores):
- sin uso compartido con protección por contraseña ni cuentas de Windows;
- sin impresoras compartidas (la casilla solo comparte archivos);
- sin recursos administrativos C$ y ADMIN$;
- sin opción 46 en PT ni opción 44 por reserva.

- **Hecho (v0.37.0)**, con la revisión de seguridad (sin hallazgos críticos ni altos):
  - Los nombres y comentarios de los recursos rechazan los caracteres de control C1, los de ancho cero, las marcas bidi
    y el BOM.
  - Las carpetas pierden los puntos y espacios finales, como en Win32.
  - Compartir `C:\` con control total se permite, como en Windows sin protección por contraseña.
  - `apt install` de un paquete quitado del laboratorio responde «Error: Unable to locate package X» (apt 3).
  - Ayuda «Compartir carpetas desde Windows» (`win-compartir`) y e2e `scripts/e2e-winshare.mjs`.
  - Pendiente: desactivar la función en el laboratorio no envía la liberación de NOMBRE<20> al servidor WINS (desmarcar la casilla del equipo sí).

### Fase 56: Servicios → Configuración y Registros, solo lo instalado (v0.37.1)

Petición: en las pestañas Configuración y Registros no deben aparecer los servicios no instalados (casilla del equipo
desmarcada).

- `configSources` (Servicios → Configuración y Estado → Configuración de la gestión web) deja fuera los servicios de
  Server y router GNU/Linux cuya casilla está desmarcada (SSH, DHCP, DNS, HTTP, correo, firewall, VPN); los parámetros
  del kernel siguen siempre y Samba solo con su paquete.
- `src/services/installed-units.ts` (`installedLogUnits`): las unidades de Registros y de la tabla de servicios de
  Estado en la gestión web, solo de lo instalado; postfix y dovecot con la casilla de correo (parados siguen en la lista, con su registro). Sin nada que mostrar, Configuración lo dice en vez de enseñar los ficheros de SSH.
- Los laboratorios grabados no cambian (sus servidores tienen marcados los servicios que usan).
- Pruebas: `tests/services/installed-only.test.ts` (servidor y router colocados desde la paleta, marcar y desmarcar,
  correo por servicio).

### Fase 57: los paquetes de servicios en el catálogo apt de cada equipo (v0.38.0)

Petición: el catálogo apt de los equipos con GNU/Linux incluye todos los paquetes de servicios de Netfix (ssh,
kea-dhcp4-server…), instalables y desinstalables desde la pestaña Configuración del equipo, sincronizados con las
pestañas Servicios, la gestión web y apt en la terminal, y limitables desde la configuración del laboratorio.

- `lab-packages.ts`: `SERVICE_PACKAGES` (openssh-server, kea-dhcp4-server, bind9, apache2, postfix, dovecot-imapd,
  dovecot-pop3d, nftables, wireguard-tools, rsyslog, samba) + `TOOL_PACKAGES` = `CATALOG_PACKAGES`. Los nombres cortos
  (ssh, kea, wireguard) siguen a su paquete: quitado openssh-server del repositorio, `apt install ssh` tampoco lo encuentra.
- `apt-offer.ts`: `devicePackages` (los paquetes de servicio que hacen algo en ese equipo: panel en Server/router,
  unidades en un PC —nftables, samba—, y después las herramientas) y `serviceOffered` (una casilla de servicio no
  instalada desaparece si el laboratorio quitó todos sus paquetes; instalada, se queda para poder quitarla).
- Configuración del equipo: apartados «Paquetes de servicios» y «Paquetes»; cada casilla es `apt install`/`apt remove`
  (`setAptInstalled`) y lee el estado de apt (`installedPackage`), así que la casilla del paquete y la del servicio
  siempre coinciden. Laboratorio actual: los mismos dos grupos en «Paquetes del repositorio apt».
- Pruebas en `tests/net/lab-packages.test.ts` y e2e de Samba (bind9 ↔ DNS, apt remove, paquete quitado por el laboratorio).
- **Hecho (v0.38.0)**, con la revisión: la casilla de un servicio de Server o router GNU/Linux también es apt
  (`setServiceBox`: instala o quita sus paquetes; la de Correo, los tres), así que nunca se contradice con las de los
  paquetes; la casilla SSH de un PC sigue siendo el cliente. Un Windows sin terminal GNU/Linux conserva sus casillas de
  servicio aunque el laboratorio quite paquetes. `isc-kea` sigue a kea-dhcp4-server. Un paquete quitado que es
  dependencia de otro llega con él (documentado).

### Fase 58: GNU/Linux y Windows homogéneos en los equipos (v0.39.0)

Petición: (1) al añadir Windows a un equipo GNU/Linux debe aparecer «Compartir archivos e impresoras para redes
Microsoft» (y funcionar como servicio), y al quitárselo a un Windows, desaparecer con su servicio; (2) todo equipo con
Windows puede compartir, también Servidores y routers GNU/Linux forzados a tener Windows; (3) con los dos sistemas, la
pestaña Servicios agrupa los paneles en GNU/Linux y Windows; (4) los paquetes que son servicios (mDNS…) pasan a
servicios, desactivados en Configuración y con su panel en Servicios; network-manager solo con panel si no repite lo
de Interfaces y TCP/IP (si no, herramienta, explicado en la ayuda); (5) gestión web armonizada con la ventana.

- **Sistemas = terminales** (`hasSystem` en device-apps.ts): Windows con su terminal marcada, GNU/Linux con la suya;
  sin ninguna, el de TCP/IP. `linuxSide`, `winShareOffered`, NetBIOS, LLMNR, mDNS nativo de Windows y el registro WINS
  de Windows la usan. El servidor SMB es el de Windows mientras comparte; si no, smbd.
- **winshare** también en `FEATURES_BY_KIND.linuxrouter` (activado); `featuresV: 4` para que una lista guardada antes
  no lo apague.
- **Servicios agrupado**: `panelGroups` (pkg-units.ts) y `systemSubnav` (ui/system-subnav.ts): con los dos sistemas,
  encabezados GNU/Linux y Windows en la lista (Windows: SMB).
- **avahi-daemon y winbind, servicios**: en `SERVICE_PACKAGES`, unidades systemd (avahi-daemon, winbind), paneles
  mDNS (en marcha, nombre publicado `host-name`, publicar o no; reinicio al aplicar) y winbind (en marcha, `wins` en
  nsswitch.conf), fichero /etc/avahi/avahi-daemon.conf (el de Ubuntu) en Configuración y su registro. mDNS de
  GNU/Linux solo con avahi-daemon en marcha (nss-mdns pregunta a través de él); wins, con winbind en marcha.
- **network-manager**: herramienta. Un panel solo repetiría direcciones, puerta de enlace, DNS y estado del enlace
  (Interfaces y TCP/IP); lo propio son los perfiles y la conectividad de `nmcli`. Explicado en la ayuda de apt.
- **Gestión web**: Servicios → mDNS, winbind y Compartir (Windows); Seguridad → Firewall y Parámetros del kernel en
  Server y router (Enrutamiento y VPN, solo router); Administración → Paquetes (el catálogo con Instalar/Quitar).
  Lo de GNU/Linux solo con su terminal; Compartir solo con Windows (`admin-extra.ts`).
- **Hecho (v0.39.0)**, con la revisión (opus):
  - cada acción de la gestión web solo corre desde su página (`ACTION_PAGES`, `securityFrom`): en un Server, la
    página Firewall solo hace lo del firewall (no rutas ni sysctl); Parámetros del kernel sigue la función `sysctl`
    del laboratorio y rechaza valores de varias líneas; un formulario genérico (DHCP…) enviado desde otra página ya no
    corre (fallo anterior a esta fase);
  - `serviceSystem` (device-apps.ts): el sistema de los servicios propios y del resolvedor por defecto (el único, o
    con los dos el de TCP/IP): SSH (SFTP, rótulo), sshd_config, `resolveHost` y la agrupación de Servicios de un
    Windows Server con terminal GNU/Linux (sus servicios, en Windows);
  - el firewall (nftables) de un Server con terminal GNU/Linux carga su fichero aunque su TCP/IP sea Windows;
    systemd-resolved funciona en el lado GNU/Linux de un equipo con los dos sistemas;
  - el registro WINS de Windows sigue a las casillas de terminal;
  - avahi-daemon.conf: borrar el nombre comenta cualquier `host-name=` sin comentar; `is_yes` como avahi; aplicar
    reinicia sin cambiar si está habilitado.

### Fase 59: liberación WINS desde el laboratorio, ficheros de Kea y BIND editables con comprobación al arrancar, estado failed y colores de systemctl (v0.40.0)

Petición: (1) liberar el nombre WINS al desactivar la función en el laboratorio; (2) que los ficheros de configuración
de DHCP y DNS se puedan editar desde la consola GNU/Linux y que, al relanzar o recargar el servicio, se comprueben con
`kea-dhcp4 -t` y `named-checkconf`/`named-checkzone`: si son correctos, se aplican; si no, como en Ubuntu, el error va
al journal y el servicio no arranca; (3) los colores de systemctl de Ubuntu.

Estado de partida:
- `sharingChanged` (`win-wins.ts`) envía el registro o la liberación de NOMBRE<20> cuando cambia el uso compartido,
  pero solo se llama desde `notifyAppsChange`. El interruptor del laboratorio (`main.ts` `setFeatures`) cambia
  `topo.features` y no avisa a ningún equipo.
- `/etc/kea/kea-dhcp4.conf`, `named.conf`, `named.conf.local` y los `db.*` son vistas de solo lectura generadas del
  modelo (`linux-files.ts`, `bind-files.ts`, montadas en `host-system.ts`): escribir en ellas da EROFS.
  `named.conf.options` y el fichero RPZ sí admiten escritura y se aplican **al guardar**, sin reiniciar nada.
- Los comprobadores ya existen y son puros: `checkKeaConf` (`kea-check.ts`), `checkNamedConf`/`loadConfZones`
  (`named-conf-check.ts`), `checkZone`/`loadZone` (`zone-check.ts`, `zone-parse.ts`). Las órdenes `kea-dhcp4 -t`,
  `named-checkconf` y `named-checkzone` ya los usan.
- systemctl no tiene estado failed. Su salida no lleva colores y el journal no guarda la prioridad de cada línea.

Decisiones tomadas por defecto (se pueden cambiar al revisar el plan):
1. **WINS**: al desactivar `winshare` en «Laboratorio actual», cada Windows que compartía envía la liberación de
   NOMBRE<20>, igual que al desmarcar su casilla. Al activarla de nuevo, los que tienen la casilla marcada lo
   registran otra vez.
2. **Ficheros editables**: `kea-dhcp4.conf` y todo lo que genera `bind-files.ts` (`named.conf`,
   `named.conf.options`, `named.conf.local`, `named.conf.default-zones`, `db.*` y RPZ). También se pueden crear zonas
   nuevas en `/etc/bind/` y declararlas en `named.conf.local`. Escribir el fichero lo convierte en un fichero normal
   del equipo, que se guarda con el laboratorio como los demás ficheros del usuario. Se edita con nano, vim, `tee`,
   `sed -i` o `>`, todos con sudo (modo 644 y propietario root, como ahora).
3. **Guardar no aplica nada, como en Ubuntu.** El cambio entra en vigor con `systemctl start|restart|reload` (también
   `try-restart` y `force-reload`), con `rndc reload` y con el interruptor del servicio en Servicios, que pasa por el
   mismo camino. `named.conf.options` y RPZ dejan de aplicarse al guardar; las pruebas que lo esperaban añaden el
   reinicio.
4. **Fichero correcto**: se traduce al modelo. Así Servicios → DHCP/DNS y la gestión web muestran lo editado y la red
   lo usa.
   - Kea: un pool por `subnet4`, con el primer rango de `pools`, `valid-lifetime`, `match-client-id`, las opciones
     `routers`, `domain-name-servers`, `domain-name` y `netbios-name-servers`, `reservations` e
     `interfaces-config`. El nombre del pool se conserva si la red coincide; si no, se llama `subnet<id>`.
   - BIND: las opciones van por `parseNamedOptions`. Las zonas `type master|primary` de `named.conf.local` toman el SOA
     y los registros A, CNAME, MX, NS, TXT y PTR de su fichero (`loadZone`). La zona es inversa si acaba en
     `in-addr.arpa`.
   - Lo que pasa la comprobación pero el modelo no representa no tiene efecto y no da error, porque el comprobador
     real lo acepta. Son, por ejemplo, varios rangos por subred, otras opciones DHCP, AAAA, SRV y las zonas
     `secondary`. Queda en el fichero y la Ayuda lo explica.
5. **Fichero incorrecto al arrancar o reiniciar.** Revisado con las unidades reales: `kea-dhcp4-server.service` de
   isc-kea 3.0.3 y `bind9.named.service` de bind9 9.20, ambas de sources.debian.org.
   - **Kea** (sin `Type=`, así que es `simple`; sin `ExecReload` ni `Restart=`): `systemctl` vuelve sin mensaje y con
     código 0, porque el proceso se lanza y muere después.
     - El journal recoge `ERROR [kea-dhcp4.dhcp4/…] DHCP4_CONFIG_LOAD_FAIL configuration error using file:
       /etc/kea/kea-dhcp4.conf, reason: …` y `ERROR … DHCP4_INIT_FAIL failed to initialize Kea server: configuration
       error using file '/etc/kea/kea-dhcp4.conf': …` (fuentes de Kea 3.0.3).
     - Después, `kea-dhcp4-server.service: Main process exited, code=exited, status=1/FAILURE` y
       `kea-dhcp4-server.service: Failed with result 'exit-code'.`.
     - La unidad queda failed y el DHCP no responde.
   - **BIND** (`Type=notify`, `Restart=on-failure`): `systemctl` imprime `Job for named.service failed because the
     control process exited with error code.` y la línea de `systemctl status`/`journalctl -xeu`.
     - El journal recoge `loading configuration from '/etc/bind/named.conf'`, el error de `named-checkconf` con
       fichero y línea, `loading configuration: failure`, `exiting (due to fatal error)` y las líneas de systemd
       (`Main process exited…`, `Failed with result 'exit-code'.`, `Failed to start named.service - BIND Domain Name
       Server.`).
     - Después vienen los reintentos de systemd (`Scheduled restart job, restart counter is at 1…5`) y
       `named.service: Start request repeated too quickly.`.
     - La unidad queda failed.
   - **Nombre de la unidad**: como en Ubuntu, pasa a ser `named.service` con el alias `bind9.service`. `systemctl
     status bind9` muestra `● named.service - BIND Domain Name Server`.
   - **Zona con errores** (`named-checkzone` falla y `named.conf` es correcto): named **arranca**, como el real, y
     solo esa zona queda sin cargar. El journal recoge `zone X/IN: loading from master file … failed: …` y
     `zone X/IN: not loaded due to errors.`, y esa zona responde SERVFAIL. Esto se aparta de «servicio no arrancado»
     porque es lo que hace Ubuntu.
6. **Recargar**:
   - Kea no tiene `ExecReload`. `systemctl reload kea-dhcp4-server` responde `Failed to reload
     kea-dhcp4-server.service: Job type reload is not applicable for unit kea-dhcp4-server.service.` (código 1) y no
     lee el fichero.
   - En Kea, `force-reload`, `reload-or-restart` y `try-reload-or-restart` reinician, con la comprobación de la
     decisión 5.
   - BIND (`ExecReload=rndc reload`): con el fichero incorrecto named sigue con la configuración anterior y en
     marcha.
     - systemctl imprime `Job for named.service failed because the control process exited with error code.`.
     - El journal recoge el error, `reloading configuration failed: failure`, `named.service: Control process
       exited, code=exited, status=1/FAILURE` y `Reload failed for named.service - BIND Domain Name Server.`.
     - `rndc reload` responde `rndc: 'reload' failed: failure`.
7. **Cambios desde la interfaz**: si Servicios o la gestión web cambian el modelo de un servicio con ficheros editados
   a mano, Netfix vuelve a generar esos ficheros a partir del modelo, como Webmin. Se detecta comparando el texto
   generado con el de la última aplicación. Una edición todavía sin aplicar se pierde, y la Ayuda lo dice.
8. **Arranque al cargar el laboratorio**: los servicios activos arrancan con los ficheros guardados, por el mismo
   camino que `bootKernel`. Si uno es incorrecto, la unidad queda failed, como tras un reinicio real.
9. **Estado failed**:
   - `systemctl status` pone el marcador `×` y `Active: failed (Result: exit-code) since …`, con la línea `Process:`
     o `Main PID: … (code=exited, status=1/FAILURE)`.
   - `is-active` imprime `failed` con código 3. `is-failed` imprime `failed` y devuelve 0, o `active` y devuelve 1.
   - `systemctl --failed` y `list-units --failed` listan las unidades caídas. `reset-failed` limpia el estado.
   - `start` o `restart` con el fichero corregido arranca la unidad. En Servicios, el interruptor queda apagado y se ve
     el error.
10. **Colores**: los de systemd 257/258, solo cuando la salida es la terminal (`isTty`). Con tubería o redirección
    salen sin color, y `SYSTEMD_COLORS=0` y `--no-pager` se aceptan.
    - Marcador: `●` verde si está activa, sin color si está inactiva, `×` rojo si ha fallado.
    - `Active:`: `active (running)` y `active (exited)` en verde negrita, `failed` en rojo negrita.
    - `Loaded:`: `enabled` en verde y `disabled` en amarillo, también en `preset:`.
    - El detalle `status=1/FAILURE` va en rojo.
    - Líneas del journal por prioridad, en `status` y en `journalctl`: err en rojo negrita, warning en amarillo,
      notice en negrita.
    - `list-units`: cabecera subrayada y filas de unidades fallidas en rojo.
    - Los códigos son los de `src/core/ansi.ts`. Para la prioridad, `LogEntry` gana un campo opcional `priority`.

Commits (TDD, uno o varios por punto):
1. `docs:` este plan.
2. `fix:` liberación de NOMBRE<20> al desactivar `winshare` en el laboratorio.
   - `Topology.setFeatures(next)` cambia las funciones y llama a `notifyAppsChange` en cada equipo.
   - `main.ts` la usa sin crecer (está en 398 líneas). Antes se comprueba que no se crea un ciclo de imports.
   - Prueba en `tests/net/win-wins.test.ts`: el servidor WINS pierde el nombre al desactivar la función y lo recupera
     al activarla.
3. `feat:` estado failed de las unidades y prioridad en el journal.
   - Cambian `units.ts` y `Server` (`failUnit`, `log(unit, line, priority?)`).
   - En `linux-services.ts`: `status`, `is-active`, `is-failed`, `--failed`, `list-units --failed` y `reset-failed`.
   - Si `linux-services.ts` pasa de 400 líneas, el formato de `status` se separa en `systemctl-status.ts`.
4. `feat:` colores de systemctl y journalctl en la terminal (`src/shells/systemd-colors.ts`).
   - Pruebas con las secuencias SGR literales, con tty y sin él.
5. `feat:` `kea-dhcp4.conf` editable y comprobado al arrancar, reiniciar y recargar.
   - El registro de ficheros de servicio (`src/shells/service-files.ts`) guarda, por equipo y ruta, el texto generado
     en la última aplicación.
   - `src/services/kea-import.ts` traduce el JSON comprobado a `PtDhcpPool[]`.
   - Un registro de comprobación al arrancar (`registerUnitCheck`) da el mismo camino a `systemctl` y al interruptor
     de Servicios, sin que `src/devices` importe de `src/shells`.
6. `feat:` ficheros de BIND editables y comprobados.
   - `src/services/bind-import.ts` construye zonas y opciones a partir de `named.conf.local` y los `db.*`.
   - Zonas con error y `rndc reload` según las decisiones 5 y 6.
   - `named.conf.options` y RPZ pasan de aplicarse al guardar a aplicarse al arrancar o recargar, y se adaptan sus
     pruebas: `dns-forwarders`, `named-conf-check`, `config-files`, `dns-rpz`, `dns-modes`, `listen` y `vim-syntax`.
7. `feat:` cambios desde la interfaz que vuelven a generar los ficheros (decisión 7), persistencia y arranque al
   cargar el laboratorio (decisión 8).
8. `docs:` Ayuda es/en.
   - «Editar kea-dhcp4.conf a mano» en DHCP, «Editar BIND a mano» en DNS, y el estado failed y los colores en la
     página de systemctl.
   - Entradas de `utils.ts` para las opciones nuevas de systemctl (no hay órdenes nuevas).
9. `test:` e2e `scripts/e2e-service-files.mjs` (puerto 8116), en la cadena `npm run e2e`.
   - Se edita `kea-dhcp4.conf` con un error y `systemctl restart` deja la unidad failed con el error en `journalctl`.
   - Se corrige el error, la unidad arranca y Servicios → DHCP muestra el pool nuevo.
   - Una zona editada responde a `dig`.
   - `systemctl status` en color.
   - Desactivar `winshare` borra el nombre del servidor WINS.
10. `chore: v0.40.0`: versión, about-data y PLAN.md.

`security-reviewer` (opus) revisa los commits 5, 6 y 7: ficheros del usuario que entran en el modelo, límites de
tamaño y de número de pools, zonas y registros, rutas de `file "…"` dentro de `/etc/bind` y `/var/cache/bind`, y
ficheros guardados en el laboratorio.

**Seguridad**:
- Los ficheros del usuario solo llegan al modelo después de pasar el comprobador. La traducción vuelve a validar cada
  valor con las mismas reglas que la interfaz: `validatePool`, nombres DNS, IP y TTL. Hay máximos de pools, reservas,
  zonas y registros.
- `file "…"` de `named.conf.local` se resuelve en el VFS. Fuera de `/etc/bind` y `/var/cache/bind` da el error de
  named («file not found»): no se leen otros ficheros del equipo.
- Lo que muestra la interfaz a partir de estos ficheros (nombres de pool, dominios, registros TXT) sale con
  `textContent`, como ahora.

**Riesgos**:
- Pruebas que dan por hecho que `named.conf.options` y RPZ se aplican al guardar (lista del commit 6).
- Las zonas inversas automáticas (`autoReverseZones`) pueden duplicar una zona inversa declarada a mano. La declarada
  gana.
- El tamaño de `linux-services.ts` (259 líneas), `host-system.ts` (263) y `server.ts` (294). Lo nuevo va en módulos
  propios.
- El cambio de nombre `bind9.service` → `named.service` toca la salida de systemctl, `ss -p` y las pruebas que la
  esperan. `bind9` sigue siendo el nombre del paquete y el alias de la unidad.
- Que la interfaz y los ficheros se desincronicen. Las dos vías pasan por el mismo modelo y por la comparación de la
  decisión 7.

**Límites** (para fases posteriores):
- sin AAAA, SRV ni zonas secundarias en el modelo (se aceptan en el fichero y no tienen efecto);
- sin varios rangos por subred, clases de cliente ni opciones DHCP fuera de las cuatro de la decisión 4;
- sin `kill -HUP` al proceso de Kea (`DHCP4_DYNAMIC_RECONFIGURATION_FAIL`);
- sin `kea-dhcp6` ni `keactrl`.

- **Hecho (v0.40.0)**, con la revisión de seguridad (sin hallazgos críticos ni altos):
  - El hallazgo bajo, un arranque que lanzaba una excepción y dejaba el modelo a medias, se corrigió: `setServices`
    vuelve al modelo anterior.
  - `systemctl reload` de una unidad parada o en failed se rechaza («Unit X.service is not active.»), como en systemd;
    `reload-or-restart` la arranca.
  - `journalctl -xeu UNIDAD`, la orden que sugiere systemctl, filtra la unidad y va al final; también `-n5`, `--unit=`
    y `--lines=`.
  - Ayuda: «Cuando un servicio no arranca» y «Los colores de systemctl y journalctl» en Servicios, «Editar
    kea-dhcp4.conf a mano» en DHCP y «Editar BIND a mano» en DNS (es/en). e2e `scripts/e2e-service-files.mjs`.
  - Límites que quedan: sin el catálogo de mensajes de `journalctl -x`; la zona inversa automática se genera aunque no
    esté declarada; las opciones solo se leen de `named.conf.options`; un `include` relativo se rechaza; un cambio
    desde la interfaz pierde lo editado y no aplicado (como en Webmin).

### Fase 60: nftables en los PC, al menos un sistema operativo, ficheros editables documentados y capturas en la ayuda (v0.41.0)

Petición (7 nov): (1) un PC recién creado muestra el paquete nftables pero no el servicio Firewall; (2) un equipo
puede tener GNU/Linux, Windows o los dos, pero no ninguno; (3) la ayuda debe documentar cada fichero de configuración
editable (de netplan a bind y kea) y sus tres vías de edición: entorno gráfico local, terminal y WebGUI en servidores
y routers Linux; (4) capturas del panel local y de la WebGUI en los servicios, empezando por los modos del DNS,
relacionadas con las directivas de los ficheros y con los comprobadores que se pueden invocar a mano.

- **Hecho (v0.41.0)**:
  - Partes 1 y 2 en el PR #13: nftables preinstalado (parado) en los PC con su panel Firewall; `setDeviceApps`
    mantiene al menos un sistema y la casilla del último queda gris.
  - Parte 3: tabla «Tres formas de editar la configuración» en GNU/Linux → ficheros (es/en), 12 ficheros × ventana,
    terminal y gestión web; corregidas las filas de kea, bind y sshd (root los edita) y postfix/dovecot (generados).
  - Parte 4: bloque de ayuda `shot` (imagen WebP con pie). `scripts/shots.mjs` captura con Playwright el panel local y
    la gestión web de DNS, DHCP y Firewall en español e inglés (`assets/docs/<id>.<es|en>.webp`, convertidas a WebP en
    el canvas del navegador, sin dependencias); `scripts/gen-shots.mjs` las incrusta en `src/ui/shots-data.ts` dentro
    de `npm run build`. Las páginas DNS (modos), DHCP de Server y nftables las muestran junto al fichero, la edición
    desde la terminal y su comprobador (`named-checkconf`/`named-checkzone`, `kea-dhcp4 -t`, `nft -c -f`).
  - Pruebas: `tests/docs/shots.test.ts` (cada captura existe en los dos idiomas, WebP y < 80 kB), paridad es/en del
    id de cada captura y `scripts/e2e-docs.mjs` comprueba que cargan.
  - Límites: `dist/netfix.html` pasa de 3,8 a 4,5 MB; faltan capturas de SSH, HTTP, correo, Samba, VPN y netplan; las
    capturas se regeneran a mano (`node scripts/shots.mjs`) cuando cambia la interfaz.

### Fase 61: capturas del resto de servicios y ficheros de correo editables; registro de ficheros editables (v0.42.0)

Petición: (1) capturas del panel local y de la gestión web para el resto de servicios; (2) que los ficheros de correo
se puedan editar y aplicar como los de Kea y BIND, y que sea lo normal para los servicios futuros.

Hecho con un enjambre ruflo jerárquico (dos escritores en worktrees aislados, integración en la sesión principal):
- **Capturas** (es/en): SSH, HTTP (Apache), Samba, VPN (WireGuard, laboratorio vpn-wireguard), netplan y correo, cada
  par con el fichero, la edición desde la terminal y su comprobador. La captura de la gestión web del firewall ya no
  muestra «cambios con nft sin guardar» (se activa y se guarda antes).
- **Correo editable**: `/etc/postfix/main.cf` y `/etc/dovecot/dovecot.conf` como kea-dhcp4.conf: root, 644, se guardan
  con el laboratorio; al arrancar, reiniciar o recargar postfix/dovecot se comprueban e importan (dominio; POP3/IMAP).
  Con errores, la unidad queda failed y un reload conserva lo que corría. Órdenes nuevas: `postconf [-n] [PARAM…]`,
  `postfix check|reload|status`, `doveconf -n`. dovecot.conf con la sintaxis de Dovecot 2.4.
- **Por defecto en adelante**: registro `EDITABLE_CONFIGS` (`src/shells/editable-configs.ts`) con Kea, BIND y correo;
  host-system.ts y hand-edits.ts lo leen. `tests/shells/editable-configs.test.ts` falla si un fichero de
  `config-files.ts` no está registrado ni justificado en `UNREGISTERED`. Regla `.claude/rules/project/service-config-files.md`.
- Límites: sin `sshd -t` como orden; sin `postfix start|stop`; los ajustes dentro de secciones de dovecot no se
  comprueban; la huella de dovecot.conf es constante (cambiar POP3 en el panel no reescribe un fichero editado).

### Fase: hostnamectl renombra el equipo (v0.43.0)

Petición: `hostnamectl set-hostname` plenamente funcional: el nombre del equipo pasa a ser el dado (misma grafía) y el
nombre de host se sigue derivando de él; los cambios se ven al momento en las ventanas del equipo y en el lienzo.

- `host-system.ts` `setName` (static): valida como systemd («Invalid static hostname 'x'») y llama a `renameDevice`
  (el mismo camino que la pestaña Equipo: etiqueta con la grafía escrita, nombre de host derivado, -2 si está cogido).
  `placedOf` (device-names.ts) da el Placed de un dispositivo. `hostname NOMBRE`, `--transient` y sysctl siguen
  rechazados. Se guarda con el laboratorio.
- La ventana del equipo cambia su título al cambiar el nombre; el lienzo se redibuja tras cada orden.
- Ayuda (clients.ts es/en, utils) y textos de la pestaña Equipo; pruebas en hostname-lock y hostname.
