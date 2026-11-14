# Mapa de dependencias de Netfix

> **Revalidado en `6e7c887` (`0.47.0`):** ver `README.md`; las cifras de `5c7b3e9` siguen valiendo salvo lo allí indicado.

> Fase 0 (auditoría), tareas 2, 3 y 7 de `NETFIX-MIGRATION-ECC.md`. Solo lectura: no se ha modificado código de producto.
> Estado auditado: `main` @ `5c7b3e9`, `package.json` versión `0.46.0` (auditado originalmente en `496a092` / `0.42.0`
> y revalidado; el plan cita `0.31.0`, que es la versión fijada por el submódulo de FixITClassroom, no la de `main`).
> Entre `496a092` y `5c7b3e9` solo cambia el trabajo de nombres de equipo (`core/hostname.ts`, `net/device-names.ts`,
> `net/{sysctl,llmnr,mdns,netbios}.ts`, el nuevo `shells/hosts-file.ts`, textos de `i18n` y `docs`).
> Documento hermano: [`CORE.md`](./CORE.md).

## 0. Método y alcance

- **Fuente auditada: `src/**/*.ts` (621 ficheros en `5c7b3e9`; 620 en `496a092`).** `_site/app/js/` es salida de build ignorada por Git
  (`.gitignore:7`), con 543 `.js` fechados el 31 de octubre: está **desfasada** respecto a `main` y no se ha usado como
  fuente. `dist/js/` (11 de noviembre) correspondía a `496a092` y se usó solo para medir tamaños; en `5c7b3e9` ya está
  desfasada (no contiene `shells/hosts-file.js`) y no se ha recompilado.
- Navegación con `graphify query` sobre `graphify-out/graph.json` (9001 nodos, indexa `src/`; generado antes de
  `shells/hosts-file.ts`, por eso los ficheros cambiados se han leído directamente). Las cifras exactas
  salen de un análisis mecánico de las sentencias `import`/`export … from` de cada fichero, separando importaciones de
  valor de las `import type` (que `erasableSyntaxOnly` + `verbatimModuleSyntax` de `tsconfig.json` borran al compilar).
- Las APIs de navegador se han buscado por expresión regular en el código sin comentarios y **cada coincidencia fuera
  de `src/ui` se ha revisado a mano** (sección 3).
- Lo que no se ha podido comprobar va marcado **NO VERIFICADO**.

## 1. Inventario por directorio

| Directorio | Ficheros | Líneas | Papel | Capa propuesta |
|---|---:|---:|---|---|
| `src/core` | 11 | 818 | IP, MAC, VLAN, reloj simulado, SHA-256, X25519, Schnorr, YAML mínimo, ANSI | L0 lógica pura |
| `src/i18n` | 51 | 3811 | Catálogos es-ES / en-GB y `t()` | L0 texto (con estado global de idioma) |
| `src/dhcp` | 7 | 1143 | Cliente y servidor DHCP | L1 protocolo |
| `src/net` | 67 | 9266 | Núcleo de simulación, pila IP, protocolos, **modelo y fichero de topología**, laboratorios de ejemplo | L1 simulación + L2 modelo + contenido |
| `src/devices` | 32 | 4340 | Router, switch, host, PC, servidor, nube, WireGuard, IPsec | L1 simulación |
| `src/ios` | 31 | 4095 | Analizador y comandos IOS, sesión | L1 simulación |
| `src/services` | 51 | 6825 | DNS, HTTP/Apache, SSH, SMB, correo, (de)serialización de servicios | L1 simulación |
| `src/bash` | 76 | 12052 | Intérprete bash, VFS, coreutils | L1 emulación de SO |
| `src/shells` | 96 | 11615 | Shell Linux y Windows, apt, systemctl, herramientas de red | L1 emulación de SO |
| `src/editors` | 18 | 2581 | vim, nano, mc, msedit (modelo de texto, sin DOM) | L1 emulación de SO |
| `src/web` | 27 | 2266 | HTTP simulado y aplicaciones web **simuladas** (admin, Roundcube); no es la UI | L1 simulación |
| `src/clients` | 6 | 638 | Clientes simulados (navegador, correo, SFTP, SMB) | L1 simulación |
| `src/labs` | 5 | 240 | Misiones guiadas | L2 contenido |
| `src/docs` | 59 | 7102 | Manual integrado (texto) | L2 contenido |
| `src/classroom` | 5 | 645 | Restricciones, checklist, presupuesto, corrección, API de incrustado | L3 evaluación e integración |
| `src/ui` | 79 | 8023 | Interfaz DOM, almacenamiento del navegador, arranque | L4 UI y adaptadores de navegador |

No hay dependencias externas de ejecución: `package.json` solo declara `typescript` en `devDependencies` y ningún
fichero de `src/` importa un paquete ni `node:*`.

## 2. Dependencias entre directorios

### 2.1 Importaciones de valor (las que existen en ejecución)

`origen → destino:número de aristas fichero→fichero`.

| Origen | Destinos |
|---|---|
| `core` | — |
| `i18n` | — |
| `dhcp` | core:11 |
| `ios` | core:35, devices:8, dhcp:3, net:3 |
| `devices` | core:31, net:30, ios:21, services:13, dhcp:9, i18n:2, shells:1, web:1 |
| `net` | core:41, devices:21, shells:12, services:11, i18n:11, ios:10, web:3, bash:1, labs:1 |
| `services` | net:24, core:23, i18n:12, bash:9, shells:5, devices:4, web:3, dhcp:1 |
| `bash` | docs:3, editors:2, core:1 |
| `shells` | net:76, services:43, core:38, devices:31, bash:28, clients:8, i18n:4, web:3 |
| `editors` | bash:2, docs:2, i18n:2 |
| `web` | services:27, i18n:22, net:15, core:9, shells:9, ios:6, devices:4, editors:2, docs:1 |
| `clients` | shells:6, i18n:2, web:2, bash:1, net:1, services:1 |
| `labs` | devices:2, ios:2, i18n:1, net:1 |
| `docs` | i18n:2, labs:2 |
| `classroom` | net:5, devices:3, core:2, ios:2, shells:2 |
| `ui` | i18n:61, net:45, core:25, services:19, shells:16, devices:11, ios:9, labs:8, classroom:6, docs:5, clients:4, editors:2, web:1 |

Cambios respecto a `496a092` (mismo método, que reproduce exactamente la tabla anterior en `496a092`):

- **Arista de directorio nueva: `bash → core`** (`bash/coreutils/hostnamectl.ts → core/hostname.ts`).
- `→ core/hostname.ts`: `net/llmnr.ts`, `net/mdns.ts`, `net/netbios.ts`, `devices/host.ts`, `devices/host-kernel.ts`,
  `shells/pkg-service.ts`.
- `shells/host-system.ts → net/device-names.ts` y `→ devices/host-kernel.ts`.
- `shells/hosts-file.ts` (nuevo) `→ net/dns.ts`, `core/ip.ts`, `devices/host-fs.ts`; sustituye a
  `shells/dns-client.ts → devices/host-fs.ts`, que desaparece.
- `shells/kernel-cmds.ts` deja de importar `i18n/t.ts` (`shells → i18n` baja de 5 a 4).

### 2.2 Importaciones solo de tipo (se borran al compilar)

Tabla de `496a092`, **no recontada** en `5c7b3e9`. Única diferencia conocida: `shells/hosts-file.ts` añade
`import type` de `devices/host.ts` y `bash/vfs.ts` (`shells → devices` y `shells → bash`, +1 cada una).

| Origen | Destinos |
|---|---|
| `shells` | devices:101, bash:55, net:39, services:21, clients:6, core:2, editors:2 |
| `net` | devices:53, services:5, bash:2, clients:2, core:1, editors:1, ios:1, labs:1, web:1 |
| `devices` | net:47, ios:13, services:7, core:6, dhcp:6, web:2, bash:1, clients:1 |
| `ui` | net:43, devices:32, i18n:11, services:11, classroom:7, ios:6, docs:5, editors:4, shells:4, clients:3, core:2, bash:1, dhcp:1, labs:1 |
| `services` | net:24, bash:8, devices:6, dhcp:2, i18n:1, shells:1, web:1 |
| `ios` | devices:17, net:6, core:2, dhcp:1 |
| `web` | devices:17, net:9, services:9, ios:3, shells:3, editors:1, i18n:1 |
| `clients` | net:6, devices:5, bash:4, shells:1, web:1 |
| `labs` | net:3, classroom:2, i18n:1, services:1 |
| resto | `bash`→editors:2; `classroom`→net:5; `dhcp`→core:3, net:3; `docs`→i18n:3, editors:1, labs:1; `editors`→bash:4 |

### 2.3 Hechos estructurales

1. **Nadie fuera de `src/ui` importa `src/ui`** (ni de valor ni de tipo). La frontera UI / motor ya existe.
2. **Solo `src/ui` importa `src/classroom` de valor** (`ui/canvas.ts`, `ui/main.ts`, `ui/mission-panel.ts`,
   `ui/palette.ts`, `ui/topbar.ts`). `src/labs` lo importa solo como tipo.
3. **No hay ciclos de importación de valor entre ficheros.** Lo garantiza el propio build: `scripts/build.mjs`
   ordena topológicamente los módulos desde `ui/main.js` y aborta con `Import cycle: …` si encuentra uno.
4. **Sí hay un ciclo entre directorios**: `net`, `devices`, `ios`, `services`, `shells`, `bash`, `web`, `clients`,
   `editors`, `labs` y `docs` forman una única componente fuertemente conexa a nivel de directorio (11 de 16). Solo
   `core`, `i18n` y `dhcp` quedan por debajo, y `classroom` y `ui` por encima.
5. Contando también los `import type`, 278 ficheros (cifra de `496a092`, no recontada) forman una sola componente fuertemente conexa (85 de `shells`, 49
   de `bash`, 34 de `net`, 27 de `services`, 26 de `devices`, 21 de `web`, 17 de `ios`…). No afecta a la ejecución,
   pero sí a cualquier intento de compilar o publicar esos directorios como paquetes con `.d.ts` separados.
6. Tres ficheros no son alcanzables desde `ui/main.ts`: `src/bash/ast.ts` y `src/net/smb-types.ts` (solo tipos) y
   `src/devices/pc-console.ts` (NO VERIFICADO si es código muerto o lo usan solo las pruebas).

### 2.4 Cierre transitivo de los puntos de entrada

Ficheros alcanzables por importaciones de valor en `5c7b3e9` y tamaño de su JavaScript compilado sin minificar
(`dist/js`, medido en `496a092`; **NO VERIFICADO** en `5c7b3e9`, donde el cierre de `evaluate.ts` crece en un fichero
—`shells/hosts-file.ts`, 102 líneas— y el resto en unas 200 líneas de TS).

| Punto de entrada | Ficheros | Líneas TS | JS sin minificar |
|---|---:|---:|---:|
| `src/core/ip.ts` | 1 | 85 | — |
| `src/classroom/restrictions.ts` | 1 | 122 | — |
| `src/classroom/checklist.ts` | 3 | 370 | — |
| `src/net/network.ts` (núcleo de simulación) | 6 | 1121 | — |
| `src/devices/host.ts` | 70 (51 son `i18n`; nuevo: `core/hostname.ts`) | 6869 | — |
| `src/net/topology.ts` (`Topology`) | 504 | 62 864 | — |
| `src/classroom/evaluate.ts` | 506 | 63 154 | 3162 KB (`496a092`) |
| `src/classroom/embed.ts` | 509 | 63 509 | — |
| `src/ui/main.ts` (aplicación completa) | 618 | 75 275 | 5199 KB (`496a092`) |

Reparto de los 3162 KB del cierre de `evaluate.ts` (en `496a092`): `docs` 778, `shells` 512, `bash` 506, `services` 295, `net` 260,
`i18n` 222, `ios` 163, `devices` 153, `web` 121, `editors` 60, `dhcp` 38, `core` 28, `classroom` 13, `labs` 3,
`clients` 3.

**Conclusión: cargar una topología arrastra todo el motor.** `Topology` importa directamente 33 módulos de `core`,
`devices`, `i18n`, `ios`, `labs`, `net`, `services`, `shells` y `web`, y por ellos llega a todo lo que no es `ui`.
Lo único que la aplicación añade sobre la corrección sin interfaz son los 79 ficheros de `ui`, 13 de `net`, 9 de
`editors`, 4 de `clients`, 3 de `classroom`, 2 de `labs`, 1 de `shells` y 1 de `docs`.

Caminos más cortos que explican las dependencias menos evidentes:

- `net/topology.ts → net/topology-host.ts → bash/vfs-persist.ts` (el fichero de topología guarda el sistema de ficheros).
- `net/topology.ts → shells/apt-auto.ts` (paquetes instalados al arrancar).
- `net/topology.ts → web/apps.ts → web/server-admin.ts → web/admin-files.ts → editors/vim-syntax.ts`.
- `bash/builtins/info.ts`, `bash/coreutils/bat.ts` y `bash/coreutils/extra.ts → docs/index.ts`: los comandos de ayuda
  del shell simulado traen el manual completo (778 KB) a la corrección en servidor.
- `devices/host.ts → i18n/t.ts → i18n/catalog.ts → i18n/es-ES/*`: todos los catálogos de ambos idiomas.

## 3. APIs de navegador y de entorno por módulo

### 3.1 Resumen

Revalidado en `5c7b3e9` sobre los ficheros cambiados: no introducen ninguna API de navegador ni de entorno nueva
(`shells/hosts-file.ts` solo usa VFS y `net/dns.ts`). La compilación sin `DOM` en `lib` hecha en esta revisión está en
[`CORE.md`](./CORE.md) §0 y §3.3 y no se repite aquí.

| API | Dónde aparece | Fuera de `src/ui` |
|---|---|---|
| `document.*` | 12 ficheros de `ui` | no |
| `window.*` | 10 ficheros de `ui` | no (la coincidencia en `docs/en/netfix.ts` es texto del manual) |
| Tipos DOM (`HTMLElement`, eventos…) | 60 ficheros de `ui` | **sí: `classroom/embed.ts:35,56-57`** |
| `localStorage` | `ui/dom.ts:52,60` y el script en línea de `ui/index.html:19` | no |
| `sessionStorage`, `indexedDB` | — | no se usan |
| `Worker`, `postMessage`, `importScripts` | — | no se usan (el incrustado es una llamada directa, no mensajería) |
| `crypto.subtle` | — | no se usa (SHA-256, X25519 y Schnorr están implementados en `src/core`) |
| `crypto.getRandomValues` | — | **sí: `core/x25519.ts:97`, `net/ssh-keys.ts:33`, `devices/router-ike.ts:92`, `devices/wireguard.ts:92`, `web/sessions.ts:8`** |
| `Math.random` | — | **sí: `bash/specials.ts:11` (`$SRANDOM`), `bash/coreutils/extra.ts:38` (barajar)** |
| `Date.now()` (hora real) | 3 ficheros de `ui` | **sí: `core/clock.ts:12`, `bash/interp-types.ts:15`, `bash/interp.ts:170`, `bash/exec.ts:141,168`** |
| `new Date(ms)` (solo formato) | — | sí, unos 25 sitios en `bash`, `shells`, `services`, `web`, `editors`, `i18n`; siempre sobre la hora simulada |
| `performance.now` | 3 ficheros de `ui` | no |
| `setTimeout` / `setInterval` | 7 ficheros de `ui` | no |
| `requestAnimationFrame` | 3 ficheros de `ui` | no |
| `fetch`, `XMLHttpRequest`, `WebSocket` | — | no se usan (`clients/browser.ts:100` es un método privado `fetch` del navegador **simulado**) |
| `navigator.*` | 3 ficheros de `ui` | no |
| `Blob`, `URL.createObjectURL`, `File` | `ui/save-file.ts:38-39,48` | no |
| `TextEncoder` / `TextDecoder` | 1 fichero de `ui` | sí: `bash/vfs.ts`, `bash/assoc-order.ts`, `bash/coreutils/tools.ts`, `bash/coreutils/text.ts`, `core/sha256.ts`, `editors/buffer.ts`, `net/ssh-keys.ts`, `shells/curl.ts`, `web/http.ts` |
| `atob` / `btoa` | — | sí: `bash/coreutils/tools.ts`, `web/http.ts` |
| `Intl.NumberFormat` / `Intl.DateTimeFormat` | — | sí: `i18n/t.ts:30-41` |
| `globalThis` | 6 ficheros de `ui` | sí: `classroom/embed.ts:68-69` (publica `globalThis.netfix`) y los cinco usos de `crypto` de arriba |
| `eval` / `new Function` | — | no (las coincidencias son métodos propios, p. ej. `bash/arith.ts:210`) |
| `async` / `await` / `Promise` | 8 ficheros de `ui` | no (las coincidencias en `bash` son el campo `async` del AST) |
| `node:*`, `process`, `require` | — | no |

### 3.2 Lectura

- **Todo el motor es síncrono y no toca el DOM.** La simulación avanza por una cola de tareas propia
  (`net/task-queue.ts`, `net/network.ts`) y `net/sync.ts` (`runSync`) adelanta el tiempo simulado hasta obtener
  resultado. Los temporizadores reales solo existen en `ui`.
- **El único fichero fuera de `ui` con API de navegador es `classroom/embed.ts`**, que mezcla lógica pura
  (`embedSession`, `evaluateFile`) con dos funciones de navegador (`checkMount`, `installApi`).
- `lib` de `tsconfig.json` incluye `DOM` y `DOM.Iterable` para **todo** `src/`: hoy el compilador no impide que un
  módulo del motor use el DOM. La limpieza actual se mantiene por disciplina, no por comprobación.
- `services/persist.ts`, `bash/vfs-persist.ts` y `net/topology-file.ts` **no son almacenamiento**: son validación y
  (de)serialización JSON puras. El único almacenamiento real es `localStorage` tras la interfaz `KeyStore`
  (`ui/workspace-store.ts:14`, `ui/main.ts:39`) y la descarga o lectura de ficheros en `ui/save-file.ts`.

## 4. Matriz de compatibilidad navegador / Node / Cloudflare Workers

Leyenda: **Sí** = ejecuta tal cual; **Adaptador** = necesita inyección o un cambio acotado; **No** = no puede ejecutarse.

| Capa o módulo | Navegador | Node ≥ 22.18 | Cloudflare Workers | Motivo |
|---|---|---|---|---|
| `core` (salvo lo indicado abajo) | Sí | Sí | Sí | Sin APIs de entorno |
| `core/clock.ts` | Sí | Sí | Sí, con reserva | `new SimClock()` toma `Date.now()` como base (ver 5.3) |
| `core/x25519.ts`, `net/ssh-keys.ts`, `devices/router-ike.ts`, `devices/wireguard.ts`, `web/sessions.ts` | Sí | Sí | Sí, con reserva | `crypto.getRandomValues` existe en Workers, pero no en el ámbito global del módulo; aquí se llama dentro de funciones. Resultado no reproducible (ver 5.3) |
| `i18n` | Sí | Sí | Sí, con reserva | `Intl` con `es-ES` / `en-GB`: soporte de datos de idioma en Workers **NO VERIFICADO**. Idioma en variable global de módulo |
| `dhcp`, `net`, `devices`, `ios`, `services`, `web`, `clients`, `editors`, `labs`, `docs` | Sí | Sí | Sí | Sin APIs de entorno; `TextEncoder`, `atob`, `btoa` existen en los tres |
| `bash`, `shells` | Sí | Sí | **Adaptador** | El corte de 4 s del intérprete usa `Date.now()` (ver 5.2). `Math.random` en dos comandos |
| `classroom/restrictions.ts`, `checklist.ts`, `budget.ts`, `evaluate.ts` | Sí | Sí | Sí | Diseñados sin DOM (cabecera de `classroom/evaluate.ts:1-5`) |
| `classroom/embed.ts` | Sí | Carga; `checkMount` lanza | Carga; `checkMount` lanza | `HTMLElement` protegido con `typeof` (`embed.ts:57`); `installApi` escribe en `globalThis` |
| `ui/*` con DOM (63 ficheros) | Sí | No | **No** | `document`, `window`, eventos, `requestAnimationFrame`, `navigator` |
| `ui/*` sin DOM (16 ficheros, p. ej. `canvas-geometry.ts`, `viewport-math.ts`, `link-labels.ts`, `workspace-store.ts`) | Sí | Sí | Sí, pero sin uso | Lógica de presentación pura; ya se prueba en Node desde `tests/ui` |
| `ui/save-file.ts`, `ui/dom.ts` | Sí | No | **No** | `Blob`, `URL.createObjectURL`, `File`, `localStorage` |

**Evidencia de ejecución:**

- Node: `npm test` ejecuta `tests/**/*.test.ts` con `node --test` sobre el motor completo, y `scripts/bench-evaluate.ts`
  carga y corrige cada laboratorio de `EXAMPLES` sin DOM.
- Workers: FixITClassroom **ya ejecuta el motor en su Worker**, importando el código fuente del submódulo
  (`FixITClassroom/src/worker/netfix.ts:6-16`: `restrictions`, `checklist`, `evaluate`, `budget`, `topology`,
  `topology-file`, `examples`, `network`). El submódulo está fijado en `4985c8c` (`v0.31.0`).
- **NO VERIFICADO:** que `main` (`0.46.0`, `5c7b3e9`) siga cargando y corrigiendo dentro del runtime de Workers. Entre
  `0.31.0` y `0.46.0` no se ha ejecutado ninguna prueba en ese runtime; solo en Node.

## 5. Riesgos de entorno que no son de DOM

### 5.1 Tamaño del bundle del Worker

El cierre de `evaluate.ts` son 506 ficheros en `5c7b3e9` y 3162 KB de JavaScript sin minificar (medido en `496a092`); 778 KB son el manual (`docs`) y
222 KB los catálogos de ambos idiomas, que la corrección no necesita. El tamaño minificado y comprimido, y su margen
frente al límite del plan de Cloudflare contratado, están **NO VERIFICADO** (no hay bundler en este repositorio; el de
FixITClassroom es `esbuild`). El coste de CPU de arranque del módulo en Workers está igualmente **NO VERIFICADO**.

### 5.2 El límite de tiempo del intérprete bash no funciona en Workers

`bash/interp.ts:170` detiene un script cuando `Date.now() > budget.deadline` (4 s, `bash/interp-types.ts:10-15`). En
Cloudflare Workers `Date.now()` no avanza mientras se ejecuta código síncrono (solo tras E/S), así que **ese corte no
salta nunca** y el contador `budget.steps` no tiene tope propio: solo existe el tope de salida (`MAX_OUTPUT`,
`interp.ts:176-177`). `withWorkLimit` (`net/network.ts:71-80`) cuenta tareas de la simulación, no pasos de bash.

Alcance real: los tipos de comprobación del checklist (`classroom/checklist.ts:10-23`) no ejecutan bash a petición del
profesor (`output` ejecuta un comando IOS, `evaluate.ts:197-205`). Que la **carga** de una topología ejecute scripts
bash del alumno (arranque de servicios, `apt-auto`, `wg-boot`, VFS persistido) está **NO VERIFICADO** y decide si esto
es un riesgo de CPU explotable o solo latente.

### 5.3 Reproducibilidad de la evaluación

| Fuente | Sitio | Efecto |
|---|---|---|
| Hora real como base del reloj | `core/clock.ts:12`, `net/topology.ts:154` | Fechas y marcas de tiempo distintas en cada corrección |
| Aleatoriedad criptográfica | los cinco usos de `crypto.getRandomValues` de 3.1 | Claves e identificadores de sesión distintos en cada carga |
| `Math.random` | `bash/specials.ts:11`, `bash/coreutils/extra.ts:38` | Solo si se ejecutan esos comandos |
| Contadores globales de módulo | `net/trace.ts:38`, `net/ping.ts:8`, `net/netbios.ts:67`, `net/llmnr.ts:41`, `net/mdns.ts:61`, `dhcp/client.ts:192`, `bash/interp.ts:38`, `bash/coreutils/fileinfo.ts:102` | Un isolate de Workers se reutiliza entre peticiones: los identificadores dependen de cuántas correcciones hizo antes |
| Idioma global | `i18n/locale.ts:18,26` | Los mensajes de error de validación (`net/topology-file.ts`) salen en el idioma global del isolate |
| Límite de trabajo global | `net/network.ts:71` | Correcto solo porque `evaluate` es síncrono; dejaría de serlo con cualquier `await` intermedio |

Que alguna de estas fuentes pueda cambiar una **nota** (y no solo un texto de detalle) está **NO VERIFICADO**. No hay
prueba que corrija dos veces el mismo fichero y compare resultados.

### 5.4 Registro por efecto de carga

Las dependencias inversas se resuelven con registros que se rellenan **al cargar un módulo**:
`net/topology.ts:27-33,55` (`registerMdns`, `registerLlmnr`, `registerSmbServer`, `registerWinsHandler`,
`registerWebApps`) y `shells/host-system.ts:355,359` (`registerHostFs`, `registerHostFileReader`). Otros registros:
`devices/ios-web.ts:15`, `devices/unit-checks.ts:23`, `devices/server-web.ts:26`, `net/ipstack.ts:33`.

Consecuencia para el empaquetado: el paquete **no puede declararse `"sideEffects": false`**, y un bundler que elimine
importaciones «sin uso» rompería el motor sin error de compilación.

## 6. Matriz de responsabilidades y dependencias permitidas

Propuesta para la fase 1. «Hoy» indica si el código actual ya la cumple.

| Capa | Responsabilidad | Puede importar | No puede importar | Hoy |
|---|---|---|---|---|
| L0 `core` | Tipos de red, aritmética, criptografía, reloj simulado | nada | todo lo demás; APIs de entorno salvo las inyectadas | Cumple, salvo `Date.now()` y `crypto` (5.3) |
| L0 `i18n` | Catálogos y formato | nada | todo lo demás | Cumple |
| L1 motor (`dhcp`, `net`, `devices`, `ios`, `services`, `bash`, `shells`, `editors`, `web`, `clients`) | Simulación de red y de sistemas operativos | L0, L1 | `ui`, `classroom`, DOM, almacenamiento, red real, Cloudflare | Cumple hacia arriba; **acoplado a L2** |
| L2 contenido (`labs`, `docs`, y `net/examples.ts`, `net/labs-*.ts`, `net/example-internet.ts`) | Laboratorios, misiones, manual | L0, L1 | `ui`, `classroom` (salvo tipos), DOM | **Incumple en sentido inverso**: L1 importa L2 (sección 7) |
| L3 evaluación (`classroom/restrictions`, `checklist`, `budget`, `evaluate`) | Política, checklist y corrección genéricas | L0, L1 | `ui`, DOM, entidades de Classroom, Cloudflare, D1, R2 | Cumple |
| L3 integración (`classroom/embed.ts`) | API de incrustado | L0, L1, L3 evaluación | DOM en la parte pura | **Incumple**: mezcla DOM y `globalThis` |
| L4 UI y adaptadores de navegador (`ui`) | Presentación, entrada, `localStorage`, ficheros, arranque | todo | — | Cumple; nadie la importa |
| FixITClassroom (consumidor) | Identidad, clases, tareas, intentos, persistencia | solo la API pública del paquete | rutas internas `src/**` de Netfix | **Incumple**: 9 rutas internas importadas directamente |

Reglas transversales propuestas:

1. Ningún módulo fuera de `src/ui` referencia `document`, `window`, `navigator`, `localStorage` ni tipos DOM.
   Comprobable compilando el motor con un `tsconfig` sin `DOM` en `lib`.
2. Ningún módulo de Netfix importa Cloudflare, D1, R2 ni entidades de Classroom (hoy se cumple: no hay ninguna
   importación externa).
3. La hora real y la aleatoriedad entran al motor por un único punto inyectable.
4. Un registro por efecto de carga solo se rellena desde un módulo que el punto de entrada público importa siempre.

## 7. Ciclos y violaciones que bloquean la extracción

Ordenados por lo que bloquean.

| # | Violación | Evidencia | Bloquea |
|---|---|---|---|
| V1 | **El modelo de topología no es separable del motor.** `Topology` construye dispositivos reales al cargar y registra servicios | `net/topology.ts` importa 33 módulos; cierre de 504 ficheros | Un «Core de modelo y validación» ligero. Validar un fichero sin simular solo es posible con `net/topology-file.ts` (`validateFile`) |
| V2 | **Ciclo de 11 directorios** en el motor | 2.3, punto 4 | Partir el motor en varios paquetes o subcarpetas con dependencias en una sola dirección |
| V3 | **`net` (capa baja) importa capas altas**: `shells` (12), `services` (11), `i18n` (11), `ios` (10), `web` (3), `bash` (1), `labs` (1) | `net/topology-host.ts → shells/host-system.ts`, `net/internet-hosts.ts → web/http.ts`, `net/topology.ts → labs/mission-state.ts` | Aislar el núcleo de simulación (`net/network.ts`, 6 ficheros) del resto de `net` |
| V4 | **Contenido dentro de `net`**: los laboratorios de ejemplo viven junto al núcleo e importan `shells`, `services`, `ios` e `i18n/es-ES/labs.ts` | `net/examples.ts`, `net/labs-linux.ts`, `net/labs-names.ts`, `net/labs-vpn.ts`, `net/labs-samba.ts`, `net/labs-security.ts`, `net/labs-resolved.ts`, `net/example-internet.ts` | Separar contenido de motor; FixITClassroom usa `EXAMPLES` desde el Worker |
| V5 | **El motor arrastra el manual** | `bash/builtins/info.ts`, `bash/coreutils/bat.ts`, `bash/coreutils/extra.ts → docs/index.ts`; `web/admin-layout.ts → docs/about-data.ts` | Tamaño del bundle del Worker (778 KB sin minificar) |
| V6 | **`bash` importa `editors` y `web` importa `editors`** | `bash/coreutils/mc.ts → editors/mc.ts`; `web/admin-files.ts → editors/vim-syntax.ts` | Tamaño; dirección de capas |
| V7 | **`classroom/embed.ts` mezcla contrato puro y navegador** | `embed.ts:35,56-57,66-69` | Publicar la evaluación y el montaje como entradas separadas |
| V8 | **`ios` ↔ `devices` y `devices` → `services`/`shells`/`web`** de valor | `ios/commands/crypto-show.ts → devices/router-ike.ts`; `devices/server-web.ts → services/apache/*`, `web/http.ts`; `devices/pc-console.ts → shells/windows.ts` | Lo mismo que V2 |
| V9 | **Estado global de módulo** | 5.3 | Reproducibilidad y aislamiento entre peticiones en un isolate reutilizado |
| V10 | **Sin API pública**: `package.json` tiene `private: true`, sin `exports`, `main` ni `types`; el consumidor importa 9 ficheros internos | `FixITClassroom/src/worker/netfix.ts:6-16`, `src/web/core/checks.ts:6`, `src/web/core/policy.ts:6-7`, `src/web/core/assignment.ts:6` | Cualquier refactor interno rompe a FixITClassroom |
| V11 | **`DOM` en `lib` para todo `src/`** | `tsconfig.json` | Garantizar por compilación la regla 1 de la sección 6 |

Lo que **no** es un bloqueo, contra lo que cabría esperar:

- No hay ciclos de valor entre ficheros; el build ya lo impide.
- No hay APIs de navegador en el motor, salvo `classroom/embed.ts`.
- No hay `async`, temporizadores reales, `fetch`, `Worker` ni `postMessage` en el motor.
- No hay dependencias de ejecución de terceros.
