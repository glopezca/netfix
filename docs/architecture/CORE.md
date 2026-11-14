# CORE — clasificación de módulos y frontera del Core

> **Revalidado en `6e7c887` (`0.47.0`):** ver `README.md`; las cifras de `5c7b3e9` siguen valiendo salvo lo allí indicado.

> **Tipo:** Fase 0 (auditoría y diseño), tareas 2, 3 y 7 de `NETFIX-MIGRATION-ECC.md`, con el desglose de la Fase 1.
> No modifica código de producto.
> **Netfix:** rama `docs/phase0-architecture` = `origin/main` @ `5c7b3e9`, `package.json` versión `0.46.0`.
> **FixITClassroom:** `main` @ `d443d98`; submódulo `vendor/netfix` @ `4985c8c` (`v0.31.0`).
> **Documentos hermanos:** [`DEPENDENCY-MAP.md`](./DEPENDENCY-MAP.md) (grafo, APIs de entorno, matriz navegador/Worker,
> violaciones V1–V11), [`PUBLIC-API.md`](./PUBLIC-API.md) (superficie pública y reproducibilidad) y
> [`CLASSROOM-CONSUMPTION.md`](./CLASSROOM-CONSUMPTION.md) (consumo actual). Este documento **no repite** sus tablas:
> las cita y añade la frontera, las reglas y el orden de extracción.
> Lo no comprobado va marcado **NO VERIFICADO**.

## 0. Método y deriva respecto a `496a092`

- Los documentos hermanos se auditaron en `496a092` (`0.42.0`). `git diff --stat 496a092 5c7b3e9 -- src` cambia 42
  ficheros (+373/−163). Todo es trabajo de nombres de equipo: `src/core/hostname.ts`, `src/net/device-names.ts`,
  `src/net/{sysctl,llmnr,mdns,netbios}.ts`, el fichero nuevo `src/shells/hosts-file.ts`, textos de `docs` e `i18n`,
  y un texto de detalle en `src/classroom/evaluate.ts` (4 líneas). `src/net/topology-file.ts`, `src/net/network.ts`
  y el resto de `src/classroom/*` no cambian.
- Aristas de importación nuevas (todas dentro de pares de directorios que ya existían, así que la tabla 2.1 de
  `DEPENDENCY-MAP.md` sigue siendo válida en estructura, aunque no en recuento exacto):
  `net/{llmnr,mdns,netbios}.ts → core/hostname.ts`, `devices/host.ts` y `devices/host-kernel.ts → core/hostname.ts`,
  `shells/host-system.ts → net/device-names.ts` y `→ devices/host-kernel.ts`,
  `shells/hosts-file.ts → net/dns.ts, core/ip.ts, devices/host-fs.ts`.
- `src/core/hostname.ts` no importa nada: `core` sigue sin dependencias fuera de sí mismo (comprobado con `grep` de
  `^import` en `src/core`: todas las importaciones son `./`).
- `graphify-out/graph.json` es del 11 de noviembre y **no contiene** `src/shells/hosts-file.ts`
  (`graphify explain "hosts-file"` no encuentra el nodo). Para lo cambiado después de `496a092` se ha leído el código.
- **Comprobación nueva de esta auditoría:** se ha compilado con `tsc --noEmit` **sin `DOM` en `lib`**
  (`--lib ES2022`, el resto de opciones de `tsconfig.json`, `--typeRoots` vacío) primero el cierre de
  `classroom/evaluate.ts` + `classroom/embed.ts` y después **los 542 ficheros de `src/` fuera de `src/ui`**. Los dos
  dan los mismos 25 sitios de error (§3.3). No se ha escrito ningún fichero.
- Pruebas ejecutadas en `5c7b3e9`: `node --test tests/{classroom,compat,labs,core}/*.test.ts` → 75 pruebas, 75 pasan.
  **NO VERIFICADO:** `npm test` completo, `npm run build` y `npm run e2e` en `5c7b3e9`.

## 1. Clasificación de `src/`

Categorías pedidas por el plan. «Evidencia» es la razón concreta, no la impresión de lectura.

| Carpeta (ficheros / líneas en `5c7b3e9`) | Categoría | Evidencia |
|---|---|---|
| `src/core` (11 / 818) | **Lógica pura** | Sin importaciones fuera de `core`. Excepciones de entorno: `core/clock.ts:12` (`Date.now()` como base por defecto) y `core/x25519.ts:97` (`crypto.getRandomValues`). `core/sha256.ts:63` usa `TextEncoder` |
| `src/i18n` (51 / 3811) | **Lógica pura** (texto), con estado global | Catálogos y `t()`. Estado de módulo `let current` en `i18n/locale.ts:18`; `withLocale` (`:36`) y `setLocale` (`:47`) lo cambian. `LOCALE_STORAGE_KEY` (`:11`) es solo el nombre de la clave: quien lee y escribe `localStorage` es `src/ui` |
| `src/dhcp` (7 / 1143) | **Simulación** (protocolo) | Solo importa `core` (tabla 2.1 de `DEPENDENCY-MAP.md`) |
| `src/net` (67 / 9266) | **Simulación** + modelo y (de)serialización de topología + contenido | Núcleo: `net/network.ts`, `net/task-queue.ts`. Modelo: `net/topology.ts`. Validación JSON pura: `net/topology-file.ts` (`validateFile`, `FILE_VERSION`). Contenido: `net/examples.ts`, `net/labs-*.ts`, `net/example-internet.ts` (V4) |
| `src/devices` (32 / 4340) | **Simulación** | Router, switch, host, servidor, nube, VPN. `devices/wireguard.ts:92` y `devices/router-ike.ts:92` usan `crypto.getRandomValues` |
| `src/ios` (31 / 4095) | **Simulación** | Analizador y comandos IOS; sin APIs de entorno |
| `src/services` (51 / 6825) | **Simulación** | DNS, HTTP, SSH, SMB, correo. `services/persist.ts` es (de)serialización, no almacenamiento (§3.2 de `DEPENDENCY-MAP.md`) |
| `src/bash` (76 / 12052) | **Simulación** (emulación de SO) | Intérprete y VFS. Hora real en `bash/interp-types.ts:15`, `bash/interp.ts:170`, `bash/exec.ts:141,168`; `Math.random` en `bash/specials.ts:11`, `bash/coreutils/extra.ts:38`. `bash/vfs-persist.ts` es serialización |
| `src/shells` (97 / 11732 en `6e7c887`; 96 / 11615 en `5c7b3e9`) | **Simulación** (emulación de SO) | Shells Linux/Windows. Registro por efecto de carga en `shells/host-system.ts:355,359` (`:340,344` en `5c7b3e9`, `:333,337` en `496a092`) |
| `src/editors` (18 / 2581) | **Simulación** (emulación de SO) | Motores de texto sin DOM; la UI dibuja el `Frame` |
| `src/web` (27 / 2266) | **Simulación** | Aplicaciones web **simuladas** dentro de la red; no es la UI. `web/sessions.ts:8` usa `crypto.getRandomValues` |
| `src/clients` (6 / 638) | **Simulación** | Clientes simulados; `clients/browser.ts` es el navegador simulado, no usa `fetch` real |
| `src/labs` (5 / 240) | **Lógica pura** (contenido de misiones) | Importa `classroom` solo como tipo (§2.3 de `DEPENDENCY-MAP.md`) |
| `src/docs` (59 / 7102) | **Lógica pura** (contenido: manual) | Lo arrastran los comandos de ayuda de bash (V5). `docs/about-data.ts` es generado |
| `src/classroom/restrictions.ts`, `checklist.ts`, `budget.ts`, `evaluate.ts` | **Evaluación** | Sin DOM; `evaluate.ts:1-5` declara que puede ejecutarse en un Worker. Ninguna entidad de Classroom (usuarios, clases, entregas) |
| `src/classroom/embed.ts` | **Integración Classroom** (mixto) | Puro: `STANDALONE` (`:25`), `embedSession` (`:44`), `evaluateFile` (`:61`). Navegador: `HTMLElement` en `:35,56,57` (`checkMount`) y escritura en `globalThis` en `:66-69` (`installApi`) |
| `src/ui` (79 / 8023) | **UI** + **adaptadores de navegador** + **almacenamiento** | DOM: `document`, `window`, eventos, `requestAnimationFrame`. Almacenamiento: `localStorage` en `ui/dom.ts` (`safeStorageGet`/`safeStorageSet`, `:50,58`) tras la interfaz `KeyStore` (`ui/workspace-store.ts`). Ficheros: `Blob`/`URL.createObjectURL`/`File` en `ui/save-file.ts`. Arranque e instalación del global: `ui/main.ts:36,374,397` |

Notas:

- **«Integración Classroom» dentro de Netfix es solo `classroom/embed.ts`.** Es genérica: un contrato de anfitrión
  (`restrictions`, `topology`, `onChange`), sin identidad ni persistencia de Classroom. El adaptador específico de
  Classroom vive en FixITClassroom (`src/worker/netfix.ts:6-16`, `src/web/core/{checks,policy,assignment}.ts`, ver
  `CLASSROOM-CONSUMPTION.md` §4–5) y **debe seguir allí**.
- **Almacenamiento real** solo hay en `src/ui` (`localStorage` y descarga/lectura de ficheros). Todo lo que se llama
  `persist` fuera de `ui` es (de)serialización pura y pertenece al Core.
- Dentro de `src/ui` hay módulos sin DOM (p. ej. `ui/canvas-geometry.ts`, `ui/viewport-math.ts`,
  `ui/workspace-store.ts`; 16 según §4 de `DEPENDENCY-MAP.md`). Esa lista no se ha recomprobado en `5c7b3e9`:
  **NO VERIFICADO**. No se proponen para el Core: el Worker no los usa.

## 2. Frontera propuesta

### 2.1 Qué va en cada parte

| Parte | Contenido | Entorno | Motivo |
|---|---|---|---|
| **Core** (paquete, neutral de runtime) | `core`, `i18n`, `dhcp`, `net`, `devices`, `ios`, `services`, `bash`, `shells`, `editors`, `web`, `clients`, `labs`, `docs`; `classroom/restrictions.ts`, `checklist.ts`, `budget.ts`, `evaluate.ts`; la parte pura de `classroom/embed.ts` (`STANDALONE`, `AppSession`, `embedSession`, `evaluateFile`, tipos `EmbedHandle`, `ChangeListener`, `NetfixApi`) | Navegador, Node ≥ 22.18, Workers | `Topology` arrastra el motor entero (V1, cierre de 503 ficheros en `496a092`): hoy no existe un «Core pequeño». Recortar `docs`/`i18n`/`editors` del cierre es optimización de tamaño (V5, V6), no condición de la frontera |
| **UI / navegador** | `src/ui/**` más `checkMount` e `installApi` (hoy en `classroom/embed.ts`) | Solo navegador | DOM, `localStorage`, `Blob`, temporizadores reales |
| **Específico de Classroom** | Nada en Netfix. Queda en FixITClassroom: `src/worker/netfix.ts` (mapea errores a `HttpError`, acota con `withWorkLimit`), `src/web/core/*`, D1, R2 | Worker y frontend de Classroom | Principio del plan §1: Core no importa Cloudflare, D1, R2, sesiones ni entidades de Classroom |

Superficie pública que expone el Core: la de `PUBLIC-API.md` §3.1–3.2, sin firmas nuevas. Nombres de subpath y build:
`PACKAGING.md`.

Lo que **no** entra en la frontera de la Fase 1 y se deja explícitamente fuera: partir el motor en varios paquetes
(bloqueado por V2, el ciclo de 11 directorios), separar el modelo de topología de la simulación (V1) y sacar el
contenido de `net` (V4). Son refactorizaciones grandes que la Fase 1 prohíbe («no hacer movimientos masivos»).

### 2.2 Reglas de dependencia permitidas

Dirección única: **UI → Core**; **Classroom (repo consumidor) → API pública del paquete**. Detalle por capa (L0–L4)
en la tabla de §6 de `DEPENDENCY-MAP.md`; aquí solo las reglas que la Fase 1 debe hacer comprobables.

| # | Regla | Estado en `5c7b3e9` | Cómo comprobarla |
|---|---|---|---|
| R1 | Nada fuera de `src/ui` importa `src/ui` (ni de valor ni de tipo) | **Cumple** (`grep` sin resultados) | `grep` en CI o prueba de grafo |
| R2 | Solo `src/ui` importa `src/classroom` de valor | **Cumple** (`labs` solo como tipo) | ídem |
| R3 | `src/core` no importa ningún otro directorio | **Cumple** | ídem |
| R4 | El Core compila sin `DOM` en `lib`: solo `ES2022` más una declaración ambiental mínima de globales web que existen en Node y Workers (`TextEncoder`, `TextDecoder`, `atob`, `btoa`, `crypto.getRandomValues`) | **Incumple en 25 sitios** (§3.3); solo 3 son DOM real | `tsc` con un `tsconfig` del Core sin `DOM` |
| R5 | Ningún fichero de `src/` importa paquetes externos, `node:*` ni Cloudflare | **Cumple** (`grep "node:"` en `src` sin importaciones; `package.json` solo tiene `typescript` en `devDependencies`) | `grep` en CI |
| R6 | La hora real y la aleatoriedad entran al Core por un punto inyectable | **Incumple** (§3.4) | prueba de determinismo |
| R7 | Un registro por efecto de carga solo se rellena desde un módulo que cualquier entrada pública importa siempre | **Cumple de hecho**: `net/topology.ts:27-33,55` y `shells/host-system.ts:355,359` están en el cierre de `Topology` | prueba de importación en Node desde la entrada pública |
| R8 | FixITClassroom solo importa la API pública | **Incumple**: 9 rutas internas en `src/worker/netfix.ts:6-16` y 4 en `src/web/core/checks.ts:6`, `policy.ts:6-7`, `assignment.ts:6` | Fase 4, no Fase 1 |

## 3. Violaciones actuales de la frontera (concretas)

### 3.1 DOM y global del navegador fuera de `src/ui`

| Sitio | Qué | Corrección propuesta |
|---|---|---|
| `src/classroom/embed.ts:35` | `NetfixApi.embed(mount: HTMLElement, …)` | El tipo `NetfixApi` puede quedarse en el Core si el parámetro pasa a un tipo estructural, o mudarse a `ui`: decisión de Fase 2 |
| `src/classroom/embed.ts:56-57` | `checkMount` (`typeof HTMLElement`, `instanceof HTMLElement`) | Mover a `src/ui` |
| `src/classroom/embed.ts:66-69` | `installApi` define `globalThis.netfix` | Mover a `src/ui` (solo lo llama `ui/main.ts:374`) |
| `tsconfig.json:6` | `lib: ["ES2022", "DOM", "DOM.Iterable"]` para todo `src/**/*.ts` (`:17`) | `tsconfig` propio del Core sin `DOM` (V11) |

No hay más usos de `document`, `window`, `navigator`, `localStorage`, `sessionStorage`, `requestAnimationFrame`,
`setTimeout`, `setInterval`, `performance.now`, `Blob` ni `URL.createObjectURL` fuera de `src/ui`: el `grep` de esta
auditoría solo encuentra comentarios, textos del manual y nombres de variables (`window` en `net/ping.ts:29,40` es un
parámetro numérico).

### 3.2 Importaciones entre capas

En `5c7b3e9` no hay ninguna arista hacia `src/ui` ni hacia `src/classroom` desde el motor (R1, R2). Las violaciones de
dirección **dentro** del Core (V3 `net` → capas altas, V5 motor → `docs`, V6 `bash`/`web` → `editors`, V8
`ios` ↔ `devices`) están en §7 de `DEPENDENCY-MAP.md` con sus aristas fichero → fichero. No bloquean la frontera
Core/UI de la Fase 1: solo el tamaño del bundle y una futura partición del motor.

### 3.3 Resultado de compilar el Core sin `DOM`

Mismos sitios para el cierre de `evaluate.ts` + `embed.ts` y para los 542 ficheros fuera de `src/ui`:

| Tipo | Sitios | Naturaleza |
|---|---|---|
| `HTMLElement` | `classroom/embed.ts:35,56,57` | **DOM real**: violación |
| `globalThis.crypto` (TS7017) | `core/x25519.ts:97`, `devices/router-ike.ts:92`, `devices/wireguard.ts:92`, `net/ssh-keys.ts:33`, `web/sessions.ts:8` | API web presente en Node y Workers; falta declararla |
| `TextEncoder` / `TextDecoder` | `bash/assoc-order.ts:14`, `bash/coreutils/text.ts:56,62`, `bash/coreutils/tools.ts:123,127`, `bash/vfs.ts:175`, `core/sha256.ts:63`, `editors/buffer.ts:67`, `net/ssh-keys.ts:69`, `shells/curl.ts:78,92`, `web/http.ts:70,88` | ídem |
| `atob` / `btoa` | `bash/coreutils/tools.ts:126,131`, `web/http.ts:64,71` | ídem |
| Arrastrados (TS18046, TS2345) | `bash/coreutils/tools.ts:127,131` | Consecuencia de los anteriores |

Conclusión: **el único cambio de código necesario para que el Core compile sin `DOM` es sacar `checkMount` e
`installApi` de `classroom/embed.ts`**; el resto se resuelve con un fichero de declaraciones ambientales del Core. Que
esas declaraciones coincidan con las de `@cloudflare/workers-types` o con los tipos de Node: **NO VERIFICADO**.

### 3.4 Entorno no inyectado (R6) y estado global

Recomprobado en `5c7b3e9` (mismas líneas que en `DEPENDENCY-MAP.md` §3.1 y §5.3):

- Hora real: `core/clock.ts:12` (`baseMs = Date.now()`), y quien construye sin base: `net/topology.ts:154`,
  `net/network.ts:103`, `devices/switch.ts:58`, `devices/router.ts:63`. Solo una prueba fija la base
  (`tests/net/hostname-lock.test.ts:154`, `new SimClock(0)`).
- Corte de tiempo de bash con hora real: `bash/interp-types.ts:15`, `bash/interp.ts:170`; `time`: `bash/exec.ts:141,168`.
  En Workers el corte no salta (§5.2 de `DEPENDENCY-MAP.md`).
- Aleatoriedad: los cinco `crypto.getRandomValues` de §3.3 y `Math.random` en `bash/specials.ts:11`,
  `bash/coreutils/extra.ts:38`.
- Estado de módulo: `workLeft` (`net/network.ts:71`), idioma `current` (`i18n/locale.ts:18`) y los contadores de §5.3
  de `DEPENDENCY-MAP.md` (líneas **NO VERIFICADO** en `5c7b3e9` para `net/llmnr.ts`, `net/mdns.ts`, `net/netbios.ts`,
  que cambiaron después de `496a092`).

## 4. Orden de extracción de la Fase 1

Principios del plan que condicionan el orden: caracterizar antes de mover, no reescribir el motor, mantener las rutas
actuales mientras reduzca riesgo, el standalone usa el mismo motor. Cada paso es un PR pequeño que deja
`npm run check` en verde y no cambia salidas de CLI, protocolos ni corpus.

Restricción del empaquetador que afecta a todos los pasos: `scripts/build.mjs:76` aborta con `export … from` y con
imports solo por efecto; admite `export { a, b as c };` local (`:65`). Una entrada del Core debe **importar y luego
exportar**, no reexportar. Que ese patrón genere bien el bundle de un solo fichero: **NO VERIFICADO** (solo se ha leído
la expresión regular). Y `scripts/build.mjs:55` parte de `ui/main.js`: una entrada del Core que la UI no importe no
entra en `dist/netfix.html`, lo cual es correcto para el standalone.

### Paso 0 — Pruebas de caracterización (sin tocar `src/`)

| Prueba | Ya cubierto por | Hueco que hay que escribir |
|---|---|---|
| Cargar y corregir en Node sin DOM | `tests/classroom/evaluate.test.ts`, `evaluate-ext.test.ts`, `budget.test.ts`, `restrictions.test.ts`, `embed.test.ts`; `tests/labs/missions.test.ts`; `scripts/bench-evaluate.ts` (todos los `EXAMPLES`) | Una prueba que afirme `typeof document === 'undefined'` y `typeof window === 'undefined'` e importe solo las rutas que usa Classroom (`CLASSROOM-CONSUMPTION.md` §4) |
| Superficie que usa Classroom | ninguna | Prueba que importe los símbolos de valor que usan `FixITClassroom/src/worker/netfix.ts:6-16` y `src/web/core/*` (`allowsDevice`, `parseRestrictions`, `parseChecklist`, `evaluate`, `WORK_LIMIT`, `EXAMPLES`, `Topology`, `validateFile`, `withWorkLimit`, `WorkLimitError`, `checkMarkingBudget`, `NO_RESTRICTIONS`, `DEVICE_KINDS`, `LABS_ES`) y compruebe que existen. Detecta roturas del consumidor antes de la Fase 4 |
| Validación de fichero | indirecta, vía `Topology.fromJSON` (45 ficheros de prueba lo usan) | **Ninguna prueba importa `src/net/topology-file.ts`**: casos de `validateFile` (versión, `format`, `MAX_DEVICES`, errores con texto) |
| Compatibilidad de formatos | `tests/compat/dhcp-v01.test.ts` con `tests/fixtures/v0.1/*.json` (formato `netsim`, v0.1) | Fixtures de `0.31.0` (lo que hoy guarda Classroom) y round-trip `fromJSON → toJSON → fromJSON` estable. Muestra real de R2: decisión D4 de `PUBLIC-API.md` |
| Determinismo de la corrección | ninguna (medición puntual en `PUBLIC-API.md` §5.2, sin prueba) | `evaluate` dos veces sobre el corpus y con reloj desplazado, resultado idéntico; incluir laboratorio VPN (`net/labs-vpn.ts`) |
| Corte de bash sin reloj que avance | ninguna (no hay pruebas de `MAX_MS`/`deadline` en `tests/bash`) | Un bucle infinito en bash con `Date.now` congelado debe terminar. Hoy fallaría (§5.2 de `DEPENDENCY-MAP.md`): documenta el defecto antes del paso 5 |
| Montaje embebido | `tests/classroom/embed.test.ts` (4 pruebas; la de `:35` cubre `checkMount` en Node); `scripts/e2e-embed.mjs` | Ninguno para el paso 2 |

### Paso 1 — Comprobación de frontera sin DOM (solo configuración)

`tsconfig` del Core (todo `src/` salvo `src/ui`) con `lib: ["ES2022"]` y un fichero de declaraciones con los cinco
globales de §3.3. Se añade a `npm run typecheck`. Resultado esperado al crearlo: fallan solo `classroom/embed.ts:35,56,57`
(medido en §3.3). Más dos comprobaciones de grafo para R1–R3 y R5 (`grep` o prueba en `tests/`).
Riesgo: bajo. No cambia código emitido.

### Paso 2 — Separar `classroom/embed.ts`

Mover `checkMount` e `installApi` a un módulo de `src/ui` (nombre a decidir) y cambiar la importación de
`ui/main.ts:36`. `embedSession`, `evaluateFile` y `STANDALONE` se quedan en su ruta actual. Tratar el tipo `HTMLElement`
de `NetfixApi` (`embed.ts:35`) según la decisión de §3.1. Corrige V7 y deja el paso 1 en verde.
Pruebas: las de `tests/classroom/embed.test.ts` (la de `checkMount` se muda con la función), `scripts/e2e-embed.mjs`.
Riesgo: bajo. Classroom no importa `embed.ts` desde el Worker (`CLASSROOM-CONSUMPTION.md` §4).

### Paso 3 — Entrada del Core en Node

Un módulo de entrada que importa y exporta la superficie de `PUBLIC-API.md` §3.1–3.2, sin mover ficheros. Prueba de
importación y ejecución en Node (plan Fase 1, tarea 9): importar la entrada, cargar un `EXAMPLES` y corregirlo.
Comprueba de paso R7 (los registros se rellenan al importar la entrada). Nombres: Fase 2 (D3 de `PUBLIC-API.md`).
Riesgo: bajo; el riesgo real (cómo se compila y publica) es de `PACKAGING.md`.

### Paso 4 — Reloj inyectable en `Topology`

`SimClock` ya acepta `baseMs`; falta pasarlo desde `Topology` y `fromJSON` como parámetro opcional (propuesta 5.3.1 de
`PUBLIC-API.md`). Sin cambio de comportamiento si no se pasa. Requiere antes la prueba de determinismo del paso 0.
Riesgo: medio (toca el constructor más importado del motor).

### Paso 5 — Corte de bash independiente de la hora real

Añadir un tope por pasos al presupuesto de `bash/interp-types.ts` además del de tiempo, para que el corte funcione en
Workers. Requiere antes la prueba del bucle infinito. Los mensajes y la salida de bash no deben cambiar
(`tests/bash/corpus/`). Riesgo: medio; valor del tope **NO VERIFICADO** (hay que medirlo con el corpus).

### Paso 6 (opcional en Fase 1, obligatorio antes de la Fase 6) — Separar «definir» de «arrancar» en `ui/main.ts`

`ui/main.ts:374` instala el global y `:397` arranca si existe `#app` (bloqueo B1 de `PUBLIC-API.md`). Es UI, no Core;
se lista para que no se olvide. Pruebas: `scripts/e2e-embed.mjs`, `scripts/e2e.mjs`. Riesgo: medio.

Fuera de la Fase 1 a propósito: aleatoriedad con semilla (solo si falla el determinismo VPN, `PUBLIC-API.md` §5.3.5),
sacar `docs`/`editors` del cierre de `evaluate` (V5, V6; afecta al tamaño, `CLASSROOM-CONSUMPTION.md` §7.2), separar
el contenido de `net` (V4) y romper el ciclo de directorios (V2).

### Criterio de GATE 1 aplicado a esta frontera

1. `typecheck` del Core sin `DOM` en verde (paso 1 + paso 2).
2. Prueba de importación y ejecución en Node desde la entrada del Core (paso 3).
3. Pruebas de caracterización del paso 0 en verde, salvo la del corte de bash si el paso 5 se aplaza, que queda
   marcada como defecto conocido.
4. `npm run check` y `npm run e2e` en verde; `dist/netfix.html` sigue generándose desde `ui/main.js`.

## 5. No verificado

- `npm test` completo, `npm run build` y `npm run e2e` en `5c7b3e9` (solo se ejecutaron 75 pruebas de `classroom`,
  `compat`, `labs` y `core`).
- Ejecución de `5c7b3e9` en el runtime de Workers (`workerd`); solo hay evidencia en Node y en `v0.31.0` desde Classroom.
- Que las declaraciones ambientales mínimas de §3.3 sean compatibles con los tipos de Node y de Cloudflare.
- Que `import` + `export { … }` local en una entrada del Core pase `scripts/build.mjs` y el build de módulos de `dist/`.
- La lista de módulos de `src/ui` sin DOM (16 según `DEPENDENCY-MAP.md`), no recomprobada.
- Las líneas de los contadores globales de `net/llmnr.ts`, `net/mdns.ts` y `net/netbios.ts` tras los cambios de nombres.
- El valor de un tope de pasos para bash que no altere el corpus.
- El recuento exacto de aristas de la tabla 2.1 de `DEPENDENCY-MAP.md` en `5c7b3e9` (la estructura no cambia; los
  números sí, ligeramente, por las aristas nuevas de §0).
