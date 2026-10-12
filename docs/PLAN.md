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

## Fase 6 · Server-PT y servicios (v0.2)

| Paso | Entregable |
|---|---|
| 6.1 | Transporte: TCP simplificado (SYN, SYN/ACK, datos, FIN, RST) y DNS sobre UDP, visibles en simulación |
| 6.2 | `Host` común (IP, cliente DHCP, TCP, resolvedor) → `Pc` y `Server` (Server-PT) |
| 6.3 | Servicios: DHCP estilo PT con reservas (motor IOS), DNS autoritativo, HTTP, SMTP/POP3/IMAP con reenvío por MX, SSH |
| 6.4 | Shells: bash de Ubuntu (`ip`, `dig`, `curl`, `ssh`, `systemctl`, `journalctl`, `ss`) y cmd de Windows (`ipconfig`, `nslookup`, `netstat`, `sc`, `net`) |
| 6.5 | UI: paleta Server-PT, pestaña Servicios, navegador, correo, terminales; guardar `.json` con selector de archivo |
| 6.6 | Revisión (code-reviewer), regresiones, e2e, documentación |
| 6.7 | Compatibilidad: referencias de la v0.1 (`tests/compat/`), filtros de salida de `show` (`\| include`, `exclude`, `begin`, `section`), escenarios Tierra Media de ASIR2-SRI (UT2 y UT3) como tests |

## Fase 7 · Servicios avanzados, bash 5.3, editores y documentación (v0.3)

| Paso | Entregable | Riesgo |
|---|---|---|
| 7.1 | DHCP Server-PT: reservas por MAC (semántica `hw-address` de Kea) o por Client-ID; concesiones automáticas identificadas por Client-ID o por MAC (`match-client-id`); convertir una concesión en reserva | Clave de binding calculada tras elegir el pool |
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
de Server-PT; documentación al día. Decisiones confirmadas con el usuario: `@` en todos los campos
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
| 8.9 | Gestión web de Server-PT al estilo WRT300N (alias `/admin` o puerto 10000, usuario/contraseña): Setup, servicios, administración, estado | Sin marcas comerciales |
| 8.10 | Documentación (pestaña y `man`), README, PLAN; revisión ECC (code + security), e2e, v0.4.0, commit y push | — |
