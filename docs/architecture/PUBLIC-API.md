# API pública y flujos de topología (Fase 0; contratos de la Fase 2 en §3)

> **Revalidado en `6e7c887` (`0.47.0`):** ver `README.md`; las cifras de `5c7b3e9` siguen valiendo salvo lo allí indicado.

> **Tipo:** auditoría y diseño (Fase 0, tareas 4, 8 y 9 de `NETFIX-MIGRATION-ECC.md`). No modifica código de producto.
> **Netfix:** `main` @ `5c7b3e9`, `package.json` versión `0.46.0` (el plan dice `0.31.0`: desactualizado). Auditado
> originalmente en `496a092` (`0.42.0`) y revalidado en `5c7b3e9`: `496a092..5c7b3e9` es trabajo de nombres de equipo
> (`hostname`, LLMNR, mDNS, NetBIOS, fichero hosts) y no cambia `TopologyFile`, `topology.ts`, `topology-file.ts`,
> `embed.ts` ni `main.ts`; en `src/classroom/` solo cambia un texto de `evaluate.ts` (§4.4).
> **FixITClassroom:** `main` @ `d443d98`; submódulo `vendor/netfix` @ `4985c8c` (`v0.31.0`).
> **Fuente citada:** `src/**/*.ts`. `_site/app/js/` es salida de build (`.gitignore:7`), con los mismos módulos en `.js`.
> Lo no comprobado se marca **NO VERIFICADO**.

## 0. Resumen

- El formato de topología es **solo JSON** (`TopologyFile`). No hay topologías YAML: `src/core/yaml-lite.ts` solo lo
  usan `src/shells/netplan.ts` y `src/shells/netplan-model.ts` (netplan dentro del Linux simulado).
- Ya existe versionado: `format: 'netfix' | 'netsim'` y `version: 1 | 2` (`FILE_VERSION = 2`,
  `src/net/topology-file.ts`). Además hay un versionado secundario `featuresV` (`FEATURES_V = 4`,
  `src/net/lab-features.ts:89`). Es el "mecanismo equivalente" a `schemaVersion` que pide la Fase 2, tarea 3.
- Ya existe una API pública de facto: `globalThis.netfix = { embed, evaluate }` (`src/classroom/embed.ts`,
  instalada en `src/ui/main.ts:374`). Classroom, además, importa 9 módulos internos por ruta profunda
  (`FixITClassroom/src/worker/netfix.ts`). La API propuesta (§3) es exactamente esa superficie, sin añadir nada.
- La corrección (`evaluate`) no usa DOM y ya la ejecuta el Worker de Classroom. Medido en `496a092`: mismo
  resultado en ejecuciones repetidas y con el reloj de pared desplazado 400 días (§5.2).

## 1. Formato de datos

### 1.1 `TopologyFile` (`src/net/topology.ts`, interfaz `TopologyFile`)

| Campo | Tipo | Desde | Notas |
|---|---|---|---|
| `format` | `'netfix' \| 'netsim'` | v0.1 | `'netsim'` en archivos de v0.4.0 y anteriores; se sigue leyendo |
| `version` | `1 \| 2` | v0.1 | se escribe siempre `FILE_VERSION` (2); se leen 1 y 2 |
| `devices` | `DeviceRecord[]` | v0.1 | máx. 500 (`MAX_DEVICES`) |
| `links` | `{ a: Endpoint, b: Endpoint, cable }[]` | v0.1 | máx. 1000; `Endpoint = { device, port }` (`src/net/network.ts`) |
| `annotations?` | `Annotation[]` | v0.8 | validado por `annotationsFromJson` (`src/net/annotations.ts`) |
| `features?`, `featuresV?` | `unknown` | v0.24 / v0.35 | se interpretan con `fileFeatures` (`src/net/lab-features.ts:98`) |
| `sambaOff?` | `unknown` | solo v0.34 | heredado; se sigue leyendo, ya no se escribe |
| `webHideOff?` | `unknown` | v0.25 | solo se escribe si es `true` |
| `pkgsOff?` | `unknown` | v0.37 | `parsePkgsOff` (`src/net/lab-packages.ts`) |
| `mission?` | `unknown` | v0.30 | `parseMissionState` (`src/labs/mission-state.ts`) |

`DeviceRecord`: `id`, `kind` (`router|switch|pc|server|linuxrouter|cloud`), `label` (≤ 64), `x`, `y`, `seed`, y según
el tipo: `config`/`startup` (líneas IOS, ≤ 20 000 líneas de ≤ 4096), `pc` (`PcRecord`), `server` (`ServerRecord`),
`cloud`. `PcRecord` incluye `files` (`FileRecord`, `src/bash/vfs-persist.ts`: `path, kind, content?, target?, mode,
uid, gid`; **sin marcas de tiempo**).

Observaciones que condicionan el diseño:

1. **`version` no cambió con cada cambio de forma.** Los campos de v0.8 a v0.37 se añadieron como opcionales bajo la
   misma `version: 2`. La compatibilidad real descansa en "campo ausente = valor por defecto" y en parsers tolerantes,
   no en migradores por versión.
2. **Lo que `validateFile` valida es la estructura externa**, no los subcampos `unknown`. Estos los validan sus
   parsers durante `Topology.fromJSON`. Validar del todo un archivo exige construir la topología.
3. **`validateFile` devuelve los campos desconocidos** (`{ ...data, annotations }`). Solo `Topology.fromJSON(x).toJSON()`
   produce la forma normal; es lo que hace Classroom al guardar una base (`checkTopology` en
   `FixITClassroom/src/worker/netfix.ts`).
4. **Una versión futura (`version: 3`) se rechaza** con `load.notNetfix` ("no es un archivo Netfix"), sin distinguir
   "demasiado nuevo" de "no es Netfix".
5. `FixITClassroom/src/worker/submissions.ts` fija a mano `EMPTY_TOPOLOGY = { format: 'netfix', version: 2, ... }`:
   una copia del número de versión fuera de Netfix.

### 1.2 Otros contratos de datos existentes

| Contrato | Módulo | Forma |
|---|---|---|
| Restricciones | `src/classroom/restrictions.ts` | `Restrictions`: `labs`, `devices`, `tabs`, `timestampPrompt` y 11 flags booleanos. Sin campo de versión. Campo desconocido = error |
| Lista de comprobación | `src/classroom/checklist.ts` | `ChecklistItem[]` (1 a 200): `id`, `title?`, `weight` (0 a 100), `check`. 11 tipos de `Check`: `device, link, ip, ping, dns, tcp, output, run, http, file, config` (`run`, 0.68.0: una orden en la bash o el cmd.exe de un PC o servidor, para Codefix). Sin versión |
| Resultado | `src/classroom/evaluate.ts` | `Evaluation`: `score`, `max`, `items: ItemResult[]`, `mission?`. Sin versión de motor ni de evaluación |
| Estado de misión | `src/labs/mission-state.ts` | `MissionState`: `id`, `hints`, `solution?` |

`docs/EMBED.md` documenta 8 tipos de comprobación; el código tiene 10 (faltan `tcp` y `output`).

## 2. Flujos actuales

Todos pasan por dos funciones: `Topology.fromJSON(unknown)` (lectura) y `Topology#toJSON()` (escritura), en
`src/net/topology.ts`.

### 2.1 Netfix independiente

| Flujo | Recorrido | Datos |
|---|---|---|
| **Creación** | `App.topbar` → `newWorkspace` → `replaceAllowed('new')` → `load(new Topology(), …)` (`src/ui/main.ts:161`). Primer arranque sin autoguardado: `initialWorkspace(…, () => EXAMPLES[0].build())` (`src/ui/main.ts:90`, `src/ui/workspace-store.ts`) | objeto `Topology` en memoria |
| **Carga de laboratorio** | selector → `EXAMPLES.find` + `allowsLab` → `startLab(ex)` → `load` (`src/ui/main.ts:165-167`, `src/labs/mission-build.ts:48`, `src/net/examples.ts:329`) | construido por código, no desde archivo |
| **Importación / carga** | `openFile` → `fileInput` (`.json,.netfix`) → `readTopologyFile(file)` → `JSON.parse` → `Topology.fromJSON` → `validateFile` → `add`/`restore` por equipo → `connect` → `bootLinked`/`bootWireguard` → `settle()` (30 s simulados) (`src/ui/save-file.ts`, `src/net/topology.ts`, `src/net/topology-file.ts`) | `TopologyFile` v1 o v2, `format` `netfix` o `netsim` |
| **Edición** | lienzo y ventanas → `App.afterCommand()`: `net.runFor(20)`, render, `scheduleSave()` (`src/ui/main.ts`, `src/ui/canvas.ts`) | mutación directa de `Topology` |
| **Autosave** | `scheduleSave` (800 ms, `AUTOSAVE_DELAY_MS`) → `flushSave` → `localStorage['netfix:workspace:v1'] = JSON.stringify(topo.toJSON())`. Lectura: `restoreWorkspace`, que también lee la clave heredada `netsim:workspace:v1` | `TopologyFile` v2 como texto |
| **Guardado** | `App.save` → `saveTopology(topo)`: `showSaveFilePicker`, o descarga `Blob`, o portapapeles si `data-embed="artifact"` → `SavedState.mark` (`src/ui/save-file.ts`) | `JSON.stringify(topo.toJSON(), null, 2)`, nombre `<prefijo>-<fecha>.netfix.json` |
| **Cambios sin guardar** | `SavedState.dirty` compara `fingerprint(topo)` = SHA-256 del JSON canónico (claves ordenadas) con `netfix:workspace-saved:v1` (`src/ui/workspace-store.ts`) | hash base64 |
| **Autocorrección de misión** | `MissionPanel` → `evaluate(this.topo.toJSON(), missionRubric(m))` (`src/ui/mission-panel.ts:158`) | mismo `evaluate` que el servidor |

### 2.2 Netfix incrustado en Classroom (hoy, por iframe)

| Flujo | Recorrido | Datos |
|---|---|---|
| **Montaje** | `netfixFrame('embed')` crea `<iframe src="/netfix/embed">` y llama `contentWindow.netfix.embed(mount, { topology, restrictions, onChange })` (`FixITClassroom/src/web/ui/netfix.ts`) → `checkMount` + `embedSession` → `start(mount, session, topology)` (`src/classroom/embed.ts`, `src/ui/main.ts:374-395`) | opciones no fiables; opción desconocida = error |
| **Autosave** | incrustado no se escribe en `localStorage`: `flushSave` → `notifyHost` → `onChange(topo.toJSON())`. Classroom ignora el argumento y llama `handle.exportTopology()` → `PUT …/autosave` (`FixITClassroom/src/web/views/attempt.ts:104,210`) → `checkSavedFile` + `checkPolicy` (`routes/attempts.ts:133-134`) → R2 `attempts/<id>/autosave.json` | `TopologyFile`; validado sin simular (`checkMarkingBudget` + `validateFile`) |
| **Base de la tarea** | profesor: `PUT …/topology` (`web/ui/base-topology.ts:110`) → `checkTopology` (`Topology.fromJSON(v).toJSON()` con `withWorkLimit`) → R2 `assignments/<id>/base-<uuid>.json`. O desde un laboratorio: `labFile(id)` = `EXAMPLES.find(…).build().toJSON()` | forma normal de Netfix |
| **Entrega** | `submitWork` → `POST …/submit { topology }` (`attempt.ts:142-148`) → `closeAttempt`: R2 `attempts/<id>/submission-<uuid>.json` + fila `submissions` con `sha256` → `requestGrading` (cola). Recogida automática: `collectAttempt` usa `currentWork` (autosave, o base, o `EMPTY_TOPOLOGY`) (`worker/submissions.ts`, `worker/collect.ts`) | texto JSON congelado + SHA-256 del texto |
| **Corrección** | consumidor de cola → `gradeSubmission` → `mark(file, parsedChecklist(checklist))` → `evaluate` → `results.items`, `auto_score = score·10/max` (`worker/grading.ts`, `worker/netfix.ts`) | `Evaluation.items` como JSON |
| **Revisión** | `submission-review.ts:50` monta la entrega con `restrictions: null` | `TopologyFile` |

Dentro de `evaluate` (`src/classroom/evaluate.ts`): `withWorkLimit(50 000)` → `checkMarkingBudget` (≤ 60 equipos,
≤ 6000 líneas IOS) → `Topology.fromJSON` → comprobaciones pasivas primero, activas (`ping, dns, http, tcp`) después →
`Evaluation`. Una comprobación nunca lanza; falla con `detail`.

**Hallazgo de persistencia en Classroom:** las tablas `submissions` y `results` no guardan versión de motor, de esquema
ni de evaluación (`FixITClassroom/migrations/0001_init.sql`, `0004_results.sql`; búsqueda de `engine|version|schema`
en `migrations/*.sql` sin resultados). La corrección usa la lista de comprobación **actual** de la tarea, no la que
había al entregar (`worker/grading.ts`, función `target`).

## 3. Contratos públicos (Fase 2, vigentes)

> **Fase 2 (PR 2.5):** esta sección sustituye a la propuesta de la Fase 0 con las decisiones D1, D2, D3 y C3. La
> superficie neutral (§3.1, §3.2, §3.6) la exporta hoy `src/pkg/core.ts` y la comprueba `tests/core/entry.test.ts`;
> los subpath `netfix/topology` y `netfix/classroom` son su reparto en el paquete (Fase 3, `PACKAGING.md`).
> Cada entrada es un símbolo existente con su nombre de hoy (D3): no hay envoltorios.

### 3.1 `netfix/topology` (neutral de runtime)

| Símbolo | Origen | Entrada → salida |
|---|---|---|
| `FILE_VERSION` | `src/net/topology-file.ts` | `2`: el `topologySchemaVersion` (D1, §4.1) |
| `validateFile` | ídem | `unknown` → `TopologyFile`; lanza `TopologyFileError` (§3.7) |
| `TopologyFileError`, tipo `TopologyFileErrorCode` | ídem | error de formato con `code` estable (D2) |
| `Topology.fromJSON` | `src/net/topology.ts` | `unknown` → `Topology` (valida, construye, asienta 30 s simulados); lanza `TopologyFileError` |
| `Topology#toJSON` | ídem | `Topology` → `TopologyFile` v2. `fromJSON(x).toJSON()` es la forma normal (punto fijo tras una carga) |
| `EXAMPLES` | `src/net/examples.ts` | `Example[]` con `id` y `build(): Topology` (C3) |
| `LABS_ES` | `src/i18n/es-ES/labs.ts` | textos en castellano de los laboratorios (C3) |
| tipos | `TopologyFile`, `DeviceRecord`, `PcRecord`, `ServerRecord`, `DeviceKind` | |

### 3.2 `netfix/classroom` (neutral de runtime)

| Símbolo | Origen | Entrada → salida |
|---|---|---|
| `parseRestrictions` | `src/classroom/restrictions.ts` | `unknown` → `Restrictions` (congelado); lanza |
| `allowsDevice`, `allowsLab`, `allowsTab`, `NO_RESTRICTIONS`, `DEVICE_KINDS` | ídem | consultas puras y valores por defecto |
| `parseChecklist` | `src/classroom/checklist.ts` | `unknown` → `readonly ChecklistItem[]`; lanza |
| `evaluate` | `src/classroom/evaluate.ts` | `(file: unknown, checklist, workLimit = WORK_LIMIT)` → `Evaluation` (con `runtime`, §3.6); lanza `TopologyFileError` o `WorkLimitError` |
| `evaluateFile` | `src/classroom/embed.ts` | `(topology: unknown, checklist: unknown)` → `Evaluation` (valida la lista antes) |
| `checkMarkingBudget`, `MARK_MAX_DEVICES`, `MARK_MAX_CONFIG_LINES` | `src/classroom/budget.ts` | `unknown` → `void`; lanza |
| `registerCheckKind`, `checkFields` (también en `netfix/authoring`) | `src/classroom/checklist.ts` | punto de extensión (S23): `(tipo, { fields, evaluate, active? })` añade un tipo de comprobación; `parseChecklist` valida sus campos con esos validadores y `evaluate` lo corrige dentro del límite de trabajo (si lanza, falla solo ese elemento). Nombre `[a-z][a-z0-9-]{0,31}`, no uno ya existente |
| `runOnHost` | `src/classroom/host-run.ts` | `(topology, etiqueta, 'linux' \| 'windows', línea)` → `{ output }` o `{ error }`: una orden en el terminal de un PC o servidor |
| `withWorkLimit`, `WorkLimitError`, `WORK_LIMIT` | `src/net/network.ts`, `src/classroom/evaluate.ts` | acotan `fromJSON` y la corrección |
| tipos | `Restrictions`, `Check`, `ExtensionCheck`, `CheckKind`, `CheckField`, `CheckOutcome`, `ChecklistItem`, `Evaluation`, `ItemResult`, `HostRun` | |

La comprobación `run` (Codefix) ya es un tipo registrado: `netfix/classroom` la registra al cargarse hasta que pase al paquete de extensión de FixIT Classroom (S23, D25).

Cubre uno a uno los imports actuales de `FixITClassroom/src/worker/netfix.ts` y `src/web/core/*`
(`tests/phase1/classroom-surface.test.ts`).

### 3.3 `netfix/ui` (solo navegador)

| Entrada | Envuelve | Entrada → salida |
|---|---|---|
| `embed` | `netfix.embed` (cierre en `src/ui/main.ts:375`, validación en `embedSession`/`checkMount`) | `(mount: HTMLElement, options?: { topology?, restrictions?, onChange? })` → `EmbedHandle` |
| `EmbedHandle.exportTopology` | `App.topo.toJSON()` | → `TopologyFile` |
| `EmbedHandle.destroy` | `App.dispose()` + `mount.replaceChildren()` | → `void` |
| tipos | `EmbedHandle`, `ChangeListener`, `NetfixApi` (`src/classroom/embed.ts`) | |

Es el `mountNetfix` del §4.3 del plan con la forma que ya existe. Lo que **no** existe y el plan pide (eventos, errores
tipados, cancelación, adaptador de persistencia) no se propone aquí: requiere decisión.

### 3.4 Neutral frente a solo navegador

| Módulo | Runtime | Evidencia |
|---|---|---|
| `src/net/topology.ts`, `topology-file.ts` | neutral | lo importa y ejecuta el Worker de Classroom |
| `src/classroom/restrictions.ts`, `checklist.ts`, `budget.ts`, `evaluate.ts` | neutral | ídem; `evaluate.ts` lo declara en su cabecera |
| `src/classroom/embed.ts` | mixto | `evaluateFile`, `embedSession` son neutrales; `checkMount` usa `HTMLElement` con guarda `typeof`; `installApi` escribe en `globalThis` |
| `src/ui/main.ts`, `save-file.ts`, `workspace-store.ts` | navegador | `document`, `window`, `localStorage`, `navigator`, `File`. `workspace-store.ts` solo usa `TextEncoder` y un `KeyStore` inyectado: su lógica es portable |
| Aleatoriedad | neutral con Web Crypto | `globalThis.crypto.getRandomValues` (disponible en Node ≥ 22 y Workers) |

**NO VERIFICADO:** el grafo completo de imports transitivos de `topology.ts` (arrastra dispositivos, servicios, shells,
web apps e i18n). Que Classroom lo ejecute hoy en Workers con v0.31.0 es evidencia fuerte, pero no se ha ejecutado
`496a092` ni `5c7b3e9` en workerd en esta auditoría. Ver `DEPENDENCY-MAP.md`.

### 3.5 Problemas de la superficie actual que la API hereda

1. **Efectos al importar.** `src/ui/main.ts` instala `globalThis.netfix` y arranca la app si existe `#app` sin
   `data-embed` (líneas 374 a 398). `src/net/topology.ts` registra mDNS, LLMNR, SMB, WINS y web apps al cargarse.
   Un `import` del paquete UI no puede ser inerte sin tocar `main.ts`.
2. **Una sola instancia por página.** `app`, `mountEl`, `session` son variables de módulo en `main.ts`; `start()`
   desmonta la anterior. `installApi` lanza si `netfix` ya existe.
3. **Estado global de módulo en el Core:** `workLeft` (`src/net/network.ts`), `current` locale (`src/i18n/locale.ts`),
   bloqueo del prompt (`forceTimestampPrompt`). Seguro en un Worker de un solo hilo y ejecución síncrona; no reentrante.
4. **Errores como `Error` con texto.** Classroom distingue validación de bug con `err.constructor === Error`
   (`worker/netfix.ts`, función `netfix`). No hay códigos de error. **Fase 2:** `validateFile` lanza `TopologyFileError` con `code` (§3.7).
5. **Idioma.** Los mensajes de `validateFile` salen de `t()` con el locale global (por defecto `es-ES`); los `detail`
   de `evaluate` están en castellano fijo en el código.

### 3.5b Edición sin simulador (`authoring`, neutral, desde 0.48.0)

Lo que necesita un editor de restricciones, listas de comprobación y laboratorios en el navegador sin cargar el
simulador (Fase 4: el front end de Classroom pasaba de 127 KB a 2,1 MB importando `topology`/`classroom`):
`allowsDevice`, `allowsLab`, `allowsTab`, `parseRestrictions`, `NO_RESTRICTIONS`, `DEVICE_KINDS`, `parseChecklist`,
`LABS_ES` y los tipos `Restrictions`, `Check`, `ChecklistItem`, `DeviceKind`. Son los mismos valores que en `classroom` y
`topology`. `pack-check` comprueba que su grafo de imports solo toca `classroom/restrictions`, `classroom/checklist`,
`i18n/*/labs` y `core/*`.

### 3.6 Metadatos (`metadata`, neutral)

| Símbolo | Origen | Valor |
|---|---|---|
| `RUNTIME_INFO` | `src/classroom/evaluate.ts` | `{ engineVersion, topologySchemaVersion, evaluationVersion }`, el mismo objeto que lleva cada `Evaluation.runtime` |
| `EVALUATION_VERSION` | ídem | `1`; sube cuando cambia la nota de un mismo archivo y lista (no por comprobaciones nuevas) |
| tipo `NetfixRuntimeInfo` | ídem | |

`engineVersion` es la `version` de `package.json` (vía `ABOUT`). **Sin `engineCommit`** (propuesta del plan): el build
no tiene paso git; con la versión publicada basta para reproducir (§5.3, punto 6). Guardarlo con la nota es de
Classroom (Fase 7).

### 3.7 Política de compatibilidad y errores de formato

- **Versión de esquema (D1):** `format` + `version`; se lee `version` 1 y 2 y los `format` `netfix` y `netsim`. `version`
  solo sube ante un cambio incompatible; los campos opcionales nuevos no la suben (§4.1). Lo comprueban los corpus
  `tests/fixtures/v0.1` (netsim), `v0.31` y `v0.46` (`tests/compat/`).
- **Errores (D2):** el contrato es `TopologyFileError.code`, unión cerrada: `not-netfix`, `incomplete`, `too-big`,
  `bad-device`, `device-data`, `device-config`, `bad-link`, `drawings` (significado en `src/net/topology-file.ts`).
  El mensaje es texto traducido y puede cambiar: no se compara. **Cambio para Classroom:** hoy distingue validación de
  fallo con `err.constructor === Error` (§3.5, punto 4); con `TopologyFileError` esa prueba da falso y un archivo
  inválido pasaría de 400 a 500. Al subir de versión (Fase 7) la prueba pasa a ser `instanceof TopologyFileError`
  (identidad de clases entre subpath: R8, Fase 3). Los demás errores de validación (`parseChecklist`,
  `parseRestrictions`, `checkMarkingBudget`) siguen siendo `Error` sin código.
- **Cambios de contrato:** quitar o renombrar un símbolo de §3.1–3.6, o un `code`, es incompatible (versión mayor del
  paquete); añadir es compatible.

## 4. Estrategia de compatibilidad de topologías

### 4.1 Versionado

- **Mantener `format` + `version` como `topologySchemaVersion`.** No añadir un `schemaVersion` paralelo: duplicaría
  `version` y obligaría a migrar todos los archivos y fixtures. `NetfixRuntimeInfo.topologySchemaVersion` =
  `FILE_VERSION`.
- **Subir `version` solo ante cambios incompatibles** (campo que cambia de significado o que un lector antiguo
  interpretaría mal). Los campos opcionales nuevos siguen sin subir versión, como hasta ahora. Esto mantiene la
  política real del proyecto desde v0.8; hay que escribirla, no cambiarla.
- `featuresV` sigue siendo el versionado interno de `features`. Documentarlo como parte del esquema.

### 4.2 Lectura hacia atrás

- Lector único: `Topology.fromJSON`. Las "migraciones" actuales son parsers tolerantes dentro de la carga
  (`fileFeatures`, `savedLabel`, `restoreHost`, `PcRecord.timestampPrompt` ignorado). No existe una función
  `migrate(v1) → v2` separada, y no hace falta crearla mientras no haya `version: 3`.
- Cuando llegue `version: 3`: un migrador puro `TopologyFile` v2 → v3 antes de `validateFile`, y `fromJSON` solo
  entiende la última. Hasta entonces, no escribirlo.
- **Lectura hacia delante:** hoy un archivo más nuevo da "no es un archivo Netfix". Propuesta mínima para Fase 2:
  mensaje propio para `version > FILE_VERSION`. Es un cambio de una rama en `validateFile`.

### 4.3 Corpus de regresión

Existe: `tests/fixtures/v0.1/*.json` (9 archivos v1 generados por el código de v0.1, commit `fdcf3d3`) y
`tests/compat/dhcp-v01.test.ts`. Falta, y es el trabajo de Fase 2 tarea 5:

| Fixture que falta | Por qué |
|---|---|
| `format: 'netsim'` | la rama se lee en `validateFile`; solo aparece en `tests/net/integration.test.ts` y `tests/services/samba-settings.test.ts` (cobertura **NO VERIFICADA**) |
| v0.24, v0.34 (`sambaOff`), v0.35, v0.37 | cada salto de `featuresV` y de campos opcionales |
| v0.31.0 | es la versión que Classroom tiene en producción: sus entregas en R2 tienen esta forma |
| round-trip de los 19 laboratorios | medido aquí a mano (§5.2); debe ser un test |

Las entregas reales de R2 son el corpus más valioso y no están en ningún repositorio. Extraer una muestra anonimizada
requiere autorización (regla 11 del plan).

### 4.4 Deriva entre v0.31.0 y v0.46.0

`git diff --stat v0.31.0..5c7b3e9 -- src/classroom src/net/topology-file.ts src/net/topology.ts src/core/clock.ts`:
cambian `src/net/topology.ts` (116 líneas, igual que en `496a092`) y `src/classroom/evaluate.ts` (4 líneas: el `detail`
de la comprobación `dns` resuelta sin DNS pasa de «por /etc/hosts» a «por el fichero hosts», `evaluate.ts:152-153`).
Las firmas y tipos de `src/classroom/*` y `validateFile` son idénticos a los que Classroom consume; el texto de
`detail` no lo es, así que una misma entrega da `results.items` con distinto texto según la versión. Los campos `pkgsOff`, `autoPackages`, `units`, `winShare`, `wins` son posteriores a v0.31:
un archivo guardado con v0.46 y leído por el Worker con v0.31 pierde esos campos al normalizar. **Navegador y Worker
deben llevar la misma versión de Netfix.**

## 5. Reproducibilidad de la evaluación

### 5.1 Fuentes de no determinismo localizadas

| Fuente | Dónde | ¿Alcanza a `evaluate`? |
|---|---|---|
| Reloj de pared | `SimClock(baseMs = Date.now())` (`src/core/clock.ts:12`); `Topology` hace `new SimClock()` sin argumento | Sí: `clock.now()` difiere en cada carga. No cambió ninguna nota en la medición (§5.2). El test de compatibilidad ya tiene que enmascarar fechas de concesiones DHCP (`tests/compat/dhcp-v01.test.ts`, `normalize`) |
| Cola de eventos | `clock.elapsed()` dirige la cola (`src/net/network.ts`, `TaskQueue`); empieza en 0 | Determinista: no depende del reloj de pared |
| `crypto.getRandomValues` | índices WireGuard (`src/devices/wireguard.ts:90`), cookies y SPI de IKE (`src/devices/router-ike.ts:90`), nonces y sesiones SSH (`src/net/ssh-keys.ts:31`, `src/services/ssh-service.ts:213`), sesiones web (`src/web/sessions.ts`) | Sí durante la carga (`bootWireguard` en `fromJSON`) y en tráfico VPN. Afecta a contenido de paquetes; que no altere aprobado/suspenso está **NO VERIFICADO** para laboratorios VPN |
| `Math.random` | `$SRANDOM` (`src/bash/specials.ts:11`), `shuf` (`src/bash/coreutils/extra.ts:38`) | No: `evaluate` no ejecuta bash del alumno |
| `Date.now` en bash | presupuesto de tiempo del intérprete (`src/bash/interp.ts:170`, `interp-types.ts:15`), `time` (`src/bash/exec.ts:141`) | **NO VERIFICADO** si la carga (`bootLinked`, unidades) ejecuta scripts bajo ese límite de tiempo real; si lo hace, una CPU lenta podría cortar distinto |
| Claves al construir laboratorios | `genKey()` en `src/net/labs-vpn.ts:184` | No a `evaluate`; sí a `labFile()`: dos llamadas dan archivos distintos |
| Locale global | `src/i18n/locale.ts` | Solo al texto de errores de validación |
| Orden de comprobaciones | `evaluate.ts`: pasivas antes que activas | Ya resuelto en el código |
| Límite de trabajo | `WORK_LIMIT = 50 000` tareas, no tiempo | Determinista por diseño |

### 5.2 Medición hecha en esta auditoría (medido en `496a092`)

Script en memoria sobre `496a092`, Node v22.23.4, sin escribir archivos. No se conservó el script y no se ha repetido
en `5c7b3e9`; entre ambos solo cambia un texto de `detail` en `evaluate.ts` y ninguna fuente de §5.1:

- Las 3 misiones (`basico`, `relay`, `nombres-redes`), archivo inicial y resuelto, con `missionRubric`: `evaluate` dos
  veces seguidas y una tercera con `Date.now` desplazado +400 días. Los 6 casos dan `Evaluation` idéntica byte a byte
  (resueltos 7/7, 7/7, 5/5; iniciales 0/7, 0/7, 1/5).
- Los 19 laboratorios de `EXAMPLES`: `fromJSON(toJSON())` es estable a partir de la segunda pasada en los 19.
  `build()` dos veces da el mismo archivo en 18; `vpn-wireguard` difiere (claves aleatorias).

Límites de la medición: 3 rúbricas de 3 a 5 elementos, ninguna con VPN, SSH ni `tcp`/`output`. No sustituye a un test.

### 5.3 Propuesta

1. **Fijar el reloj en la corrección.** `SimClock` ya acepta `baseMs`; falta que `Topology` (y `fromJSON`) lo reciba.
   Es un parámetro opcional, no una reescritura. Valor a decidir: constante, o `submitted_at` de la entrega.
2. **Registrar con cada resultado** `NetfixRuntimeInfo` (`engineVersion` = `package.json` `version`, `engineCommit`,
   `topologySchemaVersion` = `FILE_VERSION`, `evaluationVersion`). Hoy no existe `evaluationVersion`: sería una
   constante nueva en `evaluate.ts` que sube cuando cambia el significado de una comprobación. Las columnas van en
   Classroom (Fase 7), no en Netfix.
3. **Congelar la lista de comprobación con la entrega** (o su hash). Hoy se corrige con la lista actual de la tarea.
   Es decisión de Classroom.
4. **Test de determinismo en Netfix:** `evaluate` dos veces sobre el corpus, con reloj distinto, resultado idéntico.
   Incluir un laboratorio VPN para cerrar el NO VERIFICADO de §5.1.
5. **No** inyectar un generador aleatorio con semilla todavía: solo si el test del punto 4 falla en VPN. `seed` por
   dispositivo ya existe en el archivo (`DeviceRecord.seed`) y da MAC deterministas.
6. Reevaluación histórica: con `engineVersion` guardado, "reproducir" significa instalar esa versión del paquete. No
   se propone mantener varios motores cargados a la vez.

## 6. Bloqueos y decisiones pendientes

| # | Asunto | Tipo |
|---|---|---|
| B1 | `src/ui/main.ts` tiene efectos al importar (instala el global, autoarranca) y estado de instancia única. Montar sin iframe exige separar "definir" de "arrancar". Es el único cambio de código inevitable para `netfix/ui` | bloqueo técnico, Fase 1/6 |
| B2 | Sin versión de motor/evaluación en `Evaluation` ni en D1, y lista de comprobación no congelada: las notas históricas no son auditables hoy. Classroom en v0.31.0, Netfix en v0.46.0 | bloqueo de reproducibilidad, Fase 2/7 |
| B3 | Reloj de pared en `Topology` y aleatoriedad criptográfica en VPN/SSH durante la carga: determinismo medido solo en 3 misiones sin VPN | riesgo, requiere test antes de GATE 2 |
| D1 | ¿`version` actual como `topologySchemaVersion` (recomendado) o campo `schemaVersion` nuevo? | **decidida 2026-11-15:** `version` |
| D2 | ¿Errores tipados (códigos) en la API pública, o se mantiene `Error` + mensaje? Cambia el contrato con Classroom | **decidida 2026-11-15:** errores tipados con `code` |
| D3 | Nombre de `saveTopology`/`loadTopology` públicos frente a `Topology.fromJSON`/`toJSON` directos | **decidida 2026-11-15:** `fromJSON`/`toJSON` |
| D4 | Muestra de entregas reales de R2 como corpus de regresión | requiere autorización |
| D5 | Estilos: `src/ui/styles.css` era global; sin iframe colisiona con el CSS del anfitrión | **resuelta en 0.49.0** (C5): todo cuelga de `.netfix-root`; montado, Netfix no toca `<html>`, `<body>`, título ni icono de la página (`scripts/e2e-embed.mjs`). El CSS del anfitrión aún puede alcanzar a Netfix: lo acota Classroom |
