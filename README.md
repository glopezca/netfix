# netsim

Simulador de redes en el navegador inspirado en Cisco Packet Tracer, pensado para practicar
**DHCP en Cisco IOS** con la sintaxis, la ayuda contextual y las salidas del equipo real, y
**servicios de red en servidores** (DHCP, DNS, HTTP, correo y SSH) con terminales Linux y Windows.

![Área de trabajo de netsim con el laboratorio «DHCP básico»: Router0 (GW) conectado a Switch0 y a tres PCs, con luces de enlace verdes y la paleta de dispositivos abajo](docs/img/netsim-workspace.png)

- Área de trabajo lógica con routers 2911, switches 2960, PCs y **servidores Server-PT**, cables y luces de enlace.
- CLI de IOS completa para DHCP: pools de red y de host, `client-identifier`,
  `hardware-address`, reservas `address … client-id` / `address … hardware-address`,
  exclusiones, opciones, relay, snooping, cliente DHCP en interfaces y todos los `show`,
  `clear` y `debug`.
- DORA real con tramas Ethernet, ARP e IPv4 a través de switches, VLAN y routers.
- **Server-PT** con servicios DHCP, DNS, HTTP, SMTP/POP3/IMAP y SSH, configurables desde su
  pestaña Servicios o desde la terminal (`systemctl`, `sc`, `net start`).
- Terminales **GNU/Linux** (bash de Ubuntu) y **Windows** (cmd) en PCs y servidores; navegador web,
  cliente de correo y cliente SSH en los PCs.
- Modo simulación con lista de eventos (DHCP, DNS, ARP, ICMP, TCP, HTTP, SMTP, POP3, IMAP, SSH),
  animación paso a paso y la PDU de cada paquete.
- Guardar y abrir topologías completas en archivos `.json` (también la configuración de los servicios).
- Sin dependencias de ejecución: TypeScript compilado a módulos ES o a un único HTML.

## Uso rápido

```bash
npm install          # solo instala TypeScript (opcional si ya tienes tsc global)
npm run build        # dist/index.html + dist/netsim.html (archivo único, funciona sin servidor)
npm run serve        # http://localhost:8080
```

**Pruébalo online, sin instalar nada:**
**[▶ Abrir netsim DHCP Lab en el navegador](https://raw.githack.com/glopezca/netsim/main/demo/netsim-dhcp-lab.html)**

El enlace sirve [`demo/netsim-dhcp-lab.html`](demo/netsim-dhcp-lab.html), la aplicación completa en un
único archivo, a través de [raw.githack.com](https://raw.githack.com) (servicio externo; tras un push
puede tardar unos minutos en mostrar la última versión). También puedes descargar ese archivo y
abrirlo con doble clic, sin servidor ni conexión. `npm run build` lo regenera: tras cambiar el código,
haz commit de la nueva versión.
El menú **Laboratorios…** carga escenarios ya resueltos:

| Laboratorio | Qué practica |
|---|---|
| DHCP básico | `network`, `default-router`, `dns-server`, `domain-name`, `lease`, `excluded-address` |
| Reservas | pools `host` con `client-identifier` y con `hardware-address`; `address … client-id` en el pool de red |
| Relay | `ip helper-address`, `giaddr`, servidor en otra red |
| Router-on-a-stick | subinterfaces `encapsulation dot1Q`, trunk, un pool por VLAN |
| DHCP snooping | servidor falso bloqueado, `ip dhcp snooping trust`, opción 82 |
| Router como cliente | `ip address dhcp`, client-id `cisco-<mac>-<if>`, ruta por defecto AD 254 |

Interacción: doble clic en un dispositivo abre su consola (router/switch) o su escritorio
(PC). Herramienta **Cable**: clic en un dispositivo, elige puerto, clic en el otro.
En la consola funcionan `?`, `Tab`, flechas para el historial, `Ctrl+Z` y las abreviaturas
(`sh ip dhcp b`). El escritorio del PC muestra su **MAC** y su **Client-ID** listos para copiar
en `hardware-address` o `client-identifier`.

## Servidores Server-PT

Coloca un **Servidor** desde la paleta y haz doble clic. Pestañas:

| Pestaña | Qué hace |
|---|---|
| **Servicios** | Activa y configura cada servicio. Cada uno tiene su interruptor y su panel. |
| **Configuración IP** | IP estática o por DHCP, sistema operativo (Ubuntu o Windows Server), MAC y Client-ID. |
| **Terminal Linux** / **Símbolo del sistema** | Shell local del servidor. |

| Servicio | Configuración | Equivalente en el servidor real |
|---|---|---|
| **DHCP** | Pools al estilo Packet Tracer (IP inicial + usuarios máximos, gateway, DNS, dominio, TFTP, concesión), **reservas por MAC**, tabla de concesiones | `kea-dhcp4-server` · `/etc/kea/kea-dhcp4.conf` |
| **DNS** | Registros A, CNAME, MX, NS y TXT; PTR automáticos; servidor autoritativo (NOERROR, NXDOMAIN, REFUSED) | `bind9` · `/etc/bind/db.<zona>` |
| **HTTP** | Ficheros editables (`index.html`, `ayuda.html`, …), 404, banner Apache o IIS según el SO | `apache2` · `/var/www/html` |
| **Correo** | SMTP, POP3 e IMAP por separado, dominio y usuarios; **reenvío entre dominios por MX** | `postfix` + `dovecot` |
| **SSH** | Usuarios y contraseñas; las sesiones abren la shell Linux o Windows del servidor | `ssh` · `/etc/ssh/sshd_config` |
| **Registros** | `journalctl -u <servicio>` de cada servicio | `journalctl` |

El servidor DHCP de Server-PT usa el mismo motor que el router IOS, así que funciona también a
través de un relay (`ip helper-address` apuntando al servidor).

### Terminales

**GNU/Linux (Ubuntu):**
- Red: `ip a`, `ip r`, `ip neigh`, `ping [-c N]`, `sudo dhclient [-r] eth0`, `hostname -I`.
- DNS: `dig [@srv] nombre [tipo] [+short]`, `dig -x IP`, `nslookup`, `host`.
- Web y SSH: `curl [-I]`, `wget`, `ssh usuario@host`.
- Servicios: `systemctl status|start|stop|restart|enable|disable|is-active <servicio>` (con `sudo`), `journalctl -u`, `ss -tulpn`.
- Ficheros: `cat` y `ls` sobre los ficheros generados (`/etc/resolv.conf`, `/etc/netplan/…`, `/etc/kea/kea-dhcp4.conf`, `/etc/bind/…`, `/var/www/html/…`, `/etc/postfix/main.cf`, …).
- Errores reales cuando toca: `Interactive authentication required` sin `sudo`, `Command 'ifconfig' not found`, `Connection refused`, `Name or service not known`.

**Windows:**
- Red: `ipconfig [/all|/release|/renew]`, `ping [-n N]`, `arp -a`.
- DNS, web y SSH: `nslookup`, `netstat -an`, `curl [-I]`, `ssh usuario@host`.
- Servicios: `sc query|start|stop <servicio>`, `net start|stop <servicio>` (`W3SVC`, `DNS`, `DHCPServer`, `SMTPSVC`, `POP3Svc`, `sshd`).
- Sistema: `hostname`, `whoami`, `ver`.

### Aplicaciones del PC

- **Navegador**: `http://IP` o `http://nombre`. Resuelve por DNS y sigue los enlaces. La página se dibuja de forma segura, sin ejecutar scripts.
- **Correo**: cuenta con servidor entrante (POP3 o IMAP) y saliente (SMTP). Para redactar, enviar y recibir. POP3 borra del servidor; IMAP deja copia.
- **Terminales** Linux y Windows, con cliente SSH.

El laboratorio **«Server-PT: DHCP, DNS, web, correo y SSH»** lo trae todo configurado:
- Abre `http://www.aula.lab` en el navegador de PC0.
- La cuenta de correo es `ana` con contraseña `ana1`.
- Entra al servidor con `ssh admin@srv.aula.lab` (contraseña `cisco`).

### Guardar y abrir arquitecturas

**Guardar** (o `Ctrl+S`) crea un archivo `.json` con toda la topología:
- Posiciones y cables.
- Configuración IOS (running y startup).
- IP de PCs y servidores.
- Servicios, buzones y cuentas de correo.

En Chrome y Edge aparece el diálogo para elegir nombre y carpeta; en otros navegadores se descarga.
**Abrir…** recupera el archivo. Los archivos del formato anterior (v1) se siguen abriendo.

## Comandos DHCP soportados

**Configuración global**

```
service dhcp
ip dhcp pool <nombre>
ip dhcp excluded-address <baja> [<alta>]
ip dhcp conflict logging
ip dhcp ping packets <0-10> | ip dhcp ping timeout <100-10000>
ip dhcp database <url> [timeout n] [write-delay n]
ip dhcp bootp ignore
ip dhcp relay information option | trust-all | policy {drop|keep|replace}
ip dhcp smart-relay
ip dhcp use {vrf {connected|remote} | class [aaa] | subscriber-id client-id | hardware-address client-id}
```

**Pool (`Router(dhcp-config)#`)**

```
network <red> [<máscara> | /<prefijo>] [secondary]
host <ip> [<máscara> | /<prefijo>]
client-identifier <id-hex>              p. ej. 0100.5079.6668.00
hardware-address <mac> [ethernet | ieee802 | <0-255>]
client-name <nombre>
address <ip> client-id <id> [ascii]
address <ip> hardware-address <mac> [tipo]
reserved-only
default-router <ip> … (hasta 8)          dns-server <ip> …     netbios-name-server <ip> …
domain-name <dominio>                   netbios-node-type {b-node|p-node|m-node|h-node|<hex>}
lease {<días> [<horas> [<min>]] | infinite}
option <código> [instance <n>] {ascii <texto> | hex <hex> | ip <ip> …}
bootfile <archivo>                      next-server <ip> …
class <nombre>  →  address range <inicio> <fin>
origin {dhcp | ipcp | file <url>}       import all      update arp
renew deny unknown                      utilization mark {high|low} <1-100> [log]
subnet prefix-length <n>                vrf <nombre>    accounting <lista>
relay source <ip> <máscara> | relay destination <ip>
no <cualquiera de los anteriores>
```

**Interfaz**: `ip address dhcp [client-id <if>] [hostname <n>]`, `ip helper-address <ip>`,
`ip dhcp relay information trusted`, `encapsulation dot1Q <vlan>`.
**Switch**: `ip dhcp snooping`, `ip dhcp snooping vlan <lista>`,
`[no] ip dhcp snooping information option`, `ip dhcp snooping trust`,
`ip dhcp snooping limit rate <pps>`, `show ip dhcp snooping [binding]`.

**Exec**: `show ip dhcp binding [ip] | pool [nombre] | server statistics | conflict | database`,
`clear ip dhcp binding {*|ip}`, `clear ip dhcp conflict {*|ip}`, `clear ip dhcp server statistics`,
`debug ip dhcp server {events|packet}`, `undebug all`, `show debugging`,
`release dhcp <if>`, `renew dhcp <if>`, `show dhcp lease`, `ping`, `show arp`, `show ip route`.

Además: `show running-config`, `copy running-config startup-config`, `write`, `reload`,
`show ip interface brief`, `show interfaces`, `show vlan brief`, `show mac address-table`,
`clock set`, `enable secret`, `banner motd`, `interface range`, `do`, rutas estáticas…

## Cómo se identifica a un cliente (igual que en IOS)

- `client-identifier X` coincide con la opción 61 que envía el cliente. Un PC con la casilla
  «Enviar identificador de cliente» activa (por defecto, como Windows) envía `01` + MAC.
- `hardware-address M` coincide con la MAC del cliente cuando no envía opción 61 o cuando su
  opción 61 es simplemente `01` + MAC.
- Un router con `ip address dhcp` envía el client-id `cisco-<mac>-<interfaz>` (en hex empieza
  por `0063.6973.636f`), así que **para fijarle la IP hay que usar `client-identifier`**, no
  `hardware-address`: es el mismo tropiezo que en un equipo real. `show dhcp lease` lo muestra.
- Con DHCP snooping, el switch añade la opción 82 con `giaddr` 0 y el servidor IOS descarta la
  petición («inconsistent relay information») salvo que la interfaz tenga
  `ip dhcp relay information trusted` o el switch use `no ip dhcp snooping information option`.

Los pools heredan los parámetros que no definen del pool de red que los contiene (por ejemplo,
un pool `host` toma `default-router` y `dns-server` del pool de su subred).

## Desarrollo

Proyecto construido con **[Everything Claude Code](https://github.com/affaan-m/everything-claude-code)**:
reglas y agentes en `.claude/` (planner, tdd-guide, code-reviewer, typescript-reviewer,
network-config-reviewer, security-reviewer), plan por fases en `docs/PLAN.md` y guía en `CLAUDE.md`.

```bash
npm test               # node:test con type-stripping nativo (Node ≥ 22.18)
npm run test:coverage  # umbrales: 80 % líneas y funciones, 70 % ramas (núcleo)
npm run typecheck
npm run e2e            # Playwright sobre dist/ (requiere playwright instalado)
npm run check          # typecheck + tests + build
```

```
src/core      IP, MAC/client-id, reloj
src/ios       parser (gramática → trie), sesión y modos, comandos
src/dhcp      pools, servidor, reglas de coincidencia, cliente, salidas show
src/net       red de eventos discretos, pila IPv4, TCP simplificado, resolvedor DNS, rutas, topología, laboratorios
src/devices   router (plano de datos, relay), switch (VLAN, snooping), Host → PC y Server-PT
src/services  DHCP (pools PT sobre el motor IOS), DNS, HTTP, correo, SSH, unidades, persistencia
src/shells    bash de Ubuntu y cmd de Windows, cliente SSH, formatos de dig/nslookup
src/clients   cliente de correo (SMTP, POP3, IMAP)
src/ui        interfaz (SVG + DOM, sin frameworks)
```

## Limitaciones conocidas

Sin STP (los bucles de capa 2 se cortan por un límite de saltos), sin IPv6, sin enrutamiento
dinámico, un único modelo de cada dispositivo. TCP está simplificado: cada conexión lleva una
petición y una respuesta. No hay HTTPS, FTP ni DNS recursivo. SSH no cifra de verdad: en modo
simulación se muestra como «datos cifrados». Los ficheros de configuración de Linux se pueden
leer (`cat`) pero se editan desde la pestaña Servicios. Los comandos de DHCP poco habituales
(`origin`, `vrf`, `accounting`, `class`, `relay` en pool, `database`) se aceptan, se guardan y
aparecen en `show running-config`, pero no cambian la asignación.

## Licencia

- **Código** (`src/`, `tests/`, `scripts/`): [GPL-3.0-or-later](LICENSE).
- **Documentación e imágenes**: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es).
- **`.claude/`**: reglas y agentes de
  [Everything Claude Code](https://github.com/affaan-m/everything-claude-code), licencia MIT (© Affaan Mustafa).

Autoría: Germán López Castro · <https://github.com/glopezca/netsim>.
Detalles y atribución recomendada en [LICENSE.md](LICENSE.md).
