# CLASSROOM-CONSUMPTION — cómo FixITClassroom consume Netfix hoy

> **Fase 0** de `NETFIX-MIGRATION-ECC.md` (tareas 5 y 6). Auditoría de solo lectura; no se ha modificado código de producto.
> **Fecha:** 2026-11-12.
> **Netfix:** `5c7b3e9` (`git describe`: `v0.32.0-82-g5c7b3e9`; `package.json` dice `0.46.0`). Auditado originalmente contra `main` @ `496a092` (`0.42.0`); revalidado contra `5c7b3e9` (entre ambos: trabajo de nombres de equipo y un cambio de texto en `src/classroom/evaluate.ts`).
> **FixITClassroom:** `main` @ `d443d98`, árbol limpio salvo `graphify-out/` sin seguir. Rutas de este documento relativas a la raíz de FixITClassroom, salvo que se indique `netfix:`.
> Lo no comprobado va marcado **NO VERIFICADO**.

## 1. Resumen

- Classroom consume Netfix por **dos vías distintas** desde el mismo submódulo:
  1. **Imports relativos de fuentes `.ts`** (`../../vendor/netfix/src/...`) en el Worker, en el panel y en los tests. No hay paquete ni `exports`: son rutas internas de Netfix.
  2. **Bundle de navegador + CSS + icono** generados por `scripts/vendor-netfix.mjs` en `public/netfix/`, cargados en un **iframe del mismo origen**.
- **No existe `postMessage`.** El panel entra en el `contentWindow` del iframe y llama a `window.netfix.embed(mount, options)` directamente (`src/web/ui/netfix.ts:36-59`). El plan da por hecho un contrato `postMessage` (sección 2 y fase 6, tarea 7): no hay nada que retirar con ese nombre.
- La **corrección oficial ya se hace en el servidor** (`src/worker/netfix.ts` → `evaluate`), en el consumidor de la cola `fixit-grading`. La fase 5 es sobre todo cambiar el origen de los imports y añadir trazabilidad de versión, no crear la corrección.
- **No se guarda en ningún sitio la versión del motor** que corrigió una entrega (ni en D1, ni en R2, ni en `/api/health`).

## 2. Submódulo

| Dato | Valor | Fuente |
|---|---|---|
| Ruta | `vendor/netfix` | `.gitmodules` |
| URL | `https://github.com/glopezca/netfix` | `.gitmodules` |
| SHA fijado | `4985c8ca700d126bfb5307b727d26af381234688` (tag `v0.31.0`) | `git submodule status` |
| Versión del submódulo | `0.31.0`, `private: true`, `GPL-3.0-or-later` | `vendor/netfix/package.json:3-7` |
| Distancia a Netfix `main` | 84 commits (`git log 4985c8c..5c7b3e9`; eran 76 hasta `496a092`) | repo Netfix |

Diferencias entre el SHA fijado y Netfix `5c7b3e9` **en los ficheros que Classroom consume** (`git diff --stat 4985c8c 5c7b3e9`):
`src/net/topology.ts` (116 líneas), `src/ui/main.ts` (10), `src/classroom/evaluate.ts` (4), `src/net/examples.ts` (4), `src/i18n/es-ES/labs.ts` (4), `src/ui/styles.css` (3), `src/ui/web-admin.css` (2), `src/ui/docs.css` (1). **`src/net/topology-file.ts`, `src/net/network.ts` y el resto de `src/classroom/*` no cambian.** Respecto a `496a092`, la única novedad en estos ficheros es `evaluate.ts:152-153`: el fallo de la comprobación `dns` cuando el nombre se resuelve sin DNS pasa de «… sin DNS (por /etc/hosts).» a «… sin DNS (por el fichero hosts).» (y su comentario). Classroom no depende de ese texto: `grep` de `/etc/hosts`, `fichero hosts` y `sin DNS` en `FixITClassroom/src` y `tests` no encuentra nada, así que `src/web/core/text.ts` no lo traduce y llega tal cual, con la nueva redacción. El efecto de los cambios sobre Classroom es NO VERIFICADO (no se ha ejecutado la suite de Classroom contra `5c7b3e9`).

El protocolo manual de subida del submódulo está en `docs/PLAN.md:455-470` (revisar listas de comprobación y bases publicadas antes de subir).

## 3. Integración en el navegador

### 3.1 Build y copia de ficheros

`scripts/vendor-netfix.mjs` (ejecutado por `npm run vendor:netfix`, que forma parte de `build:web`; `package.json` scripts):

1. Falla si no existe `vendor/netfix/src/ui/main.ts` (submódulo sin inicializar).
2. Empaqueta con esbuild `vendor/netfix/src/ui/main.ts` → `public/netfix/netfix.js` (`bundle`, `format: esm`, `target: es2022`, `minify`). **No usa el build propio de Netfix** porque escribe dentro del submódulo (comentario de cabecera y `docs/PLAN.md:533-535`).
3. Copia tal cual: `src/ui/styles.css`, `src/ui/web-admin.css`, `src/ui/docs.css`, `assets/brand/favicon.png`.
4. Exporta `COPIED`, `BUNDLE`, `FILES`, tipados en `scripts/vendor-netfix.d.mts` y usados por `tests/web/html.test.ts:63-70`.

`public/netfix/*` está ignorado por git **salvo los `.html`** (`.gitignore`). Tamaño medido del bundle actual: `netfix.js` 2 116 597 bytes (756 383 gzip).

Cadena de despliegue: `wrangler.toml` `[build] command = "npm run build:web"` y `[assets] directory = "./public"`; `npm run check` termina en `build:web`; `deploy:staging` aplica migraciones y despliega. Los tres jobs de `.github/workflows/ci.yml` hacen `actions/checkout@v4` con `submodules: true`.

### 3.2 Páginas e iframe

- `public/netfix/embed.html`: `<div id="app" data-embed>`; `data-embed` impide el arranque autónomo (`vendor/netfix/src/ui/main.ts:397-398`). Carga `/netfix/netfix.js` y las tres hojas CSS, más Google Fonts.
- `public/netfix/lab.html`: `<div id="app">` sin `data-embed`; Netfix arranca solo (laboratorio libre del profesor; guarda en el navegador y en ficheros, nada va al servidor: `src/web/views/netfix.ts:152-161`).
- `src/web/ui/netfix.ts`: `netfixFrame(page)` crea `<iframe class="netfix-frame" src="/netfix/${page}">`, espera el evento `load` (tiempo máximo 60 s) y en `embed()` lee `contentWindow.netfix` con `Reflect.get` y el `#app` **del documento del iframe** (Netfix comprueba `instanceof HTMLElement` en su propio realm: `vendor/netfix/src/classroom/embed.ts:58-60`).
- CSP en `public/_headers`: `/*` lleva `frame-src 'self'` y `frame-ancestors 'none'`; `/netfix/*` la sustituye por `script-src 'self'`, `frame-src 'none'`, `frame-ancestors 'self'`. Probado en `tests/web/html.test.ts:54-73`.
- Estilo del marco: `.netfix-frame` en `public/app.css:211`.

### 3.3 Contrato real (API global, no `postMessage`)

Definido en Netfix, `vendor/netfix/src/classroom/embed.ts` (documentado en `vendor/netfix/docs/EMBED.md`):

```ts
// globalThis.netfix, instalado con Object.defineProperty no configurable; lanza si se instala dos veces (embed.ts:66-70)
interface NetfixApi {
  embed(mount: HTMLElement, options?: unknown): EmbedHandle;
  evaluate(topology: unknown, checklist: unknown): Evaluation;
}
interface EmbedHandle { exportTopology(): TopologyFile; destroy(): void; }
// options admitidas: solo { topology, restrictions, onChange }; cualquier otra clave lanza (embed.ts:44-55)
```

Lo que Classroom usa (`src/web/ui/netfix.ts:11-25`): `embed`, `exportTopology`, `destroy`. **No usa `netfix.evaluate` en el navegador.** `onChange` se declara en Netfix como `(file: TopologyFile) => void`, pero Classroom lo usa sin argumentos (solo como señal de cambio) y pide el fichero con `exportTopology()`.

| Consumidor | `topology` | `restrictions` | `onChange` |
|---|---|---|---|
| Intento del alumno, `src/web/views/attempt.ts:197-210` | `GET /api/attempts/:id/topology` | las de `GET /api/attempts/:id` | `saver.change()` (autoguardado) |
| Topología base, `src/web/ui/base-topology.ts:80-98` | `GET /api/assignments/:aid/topology` o `undefined` (404) | `{}` | cuenta ediciones |
| Revisión de entrega, `src/web/ui/submission-review.ts:41-51` | `GET /api/submissions/:sid/topology` | `null` | no-op |
| Laboratorio libre, `src/web/views/netfix.ts:153-160` | — (página `lab`, sin `embed`) | — | — |

Contratos por URL: solo las rutas estáticas `/netfix/embed` y `/netfix/lab` (sin parámetros de consulta) y el enlace «pantalla completa» a `/netfix/lab` (`src/web/views/netfix.ts:159`).

## 4. Integración en el Worker

Todo pasa por un único módulo, `src/worker/netfix.ts` (98 líneas), que importa de `vendor/netfix/src/`:

| Import | Módulo de Netfix | Uso en Classroom |
|---|---|---|
| `parseRestrictions`, `allowsDevice` | `classroom/restrictions.ts` | `checkRestrictions`, `samePolicy`, `checkPolicy` |
| `parseChecklist`, tipo `ChecklistItem` | `classroom/checklist.ts` | `checkChecklist`, `parsedChecklist` |
| `evaluate`, `WORK_LIMIT`, tipo `Evaluation` | `classroom/evaluate.ts` | `mark` (corrección) y límite de `checkTopology` |
| `checkMarkingBudget` | `classroom/budget.ts` | `checkTopology`, `checkSavedFile` |
| `EXAMPLES` | `net/examples.ts` | `labFile` (topología de un laboratorio) |
| `Topology`, tipo `TopologyFile` | `net/topology.ts` | `checkTopology` (`fromJSON().toJSON()`), `checkPolicy` |
| `validateFile` | `net/topology-file.ts` | `checkSavedFile`, `checkPolicy` |
| `withWorkLimit`, `WorkLimitError` | `net/network.ts` | `checkTopology`, traducción de errores |

Dependencias de comportamiento, no solo de símbolos:

- **Errores:** `netfix()` (`src/worker/netfix.ts:22-29`) convierte en 400 los errores cuyo `constructor === Error` o que son `instanceof WorkLimitError`; todo lo demás es 500. El mensaje de Netfix llega al cliente (recortado a 300 caracteres). Cambiar las clases de error de Netfix, o duplicar `WorkLimitError` en dos bundles, cambia 400 por 500.
- **Forma normal:** `samePolicy` compara `JSON.stringify(parseRestrictions(x))`; `checkChecklist` guarda la forma normal de `parseChecklist`; `checkTopology` guarda `Topology.fromJSON(v).toJSON()`. Un cambio de normalización en Netfix cambia lo que se guarda y si una política «ha cambiado».
- **Forma del fichero:** `checkPolicy` lee `devices[].id`, `devices[].kind`, `links[].a|b.device|port` (`src/worker/netfix.ts:78-93`).
- **Constante copiada:** `EMPTY_TOPOLOGY = { format: 'netfix', version: 2, devices: [], links: [] }` está escrita a mano en `src/worker/submissions.ts:15` y `src/worker/routes/assignment-topology.ts:42` (no usa `FILE_VERSION` de `vendor/netfix/src/net/topology-file.ts:7`).
- **Forma de `Evaluation`:** `gradeSubmission` usa `e.items`, `e.score`, `e.max` (`src/worker/grading.ts:91-93`); `routes/results.ts:52-58` lee de cada item `id`, `title?`, `weight`, `passed`, `detail`.

**Peso medido** (esbuild en memoria, `write: false`, minificado, sin escribir nada): el bundle del Worker son 1 984 312 bytes (672 829 gzip), de los que 1 790 653 son de Netfix: **449 de 497 módulos**. `evaluate` arrastra `net`, `devices`, `services`, `bash`, `shells`, `ios`, `web`, `docs`, `editors`, `dhcp`, `i18n` (49 módulos) y `labs`. El tamaño que produce Wrangler en el despliegue real y el consumo de CPU por corrección son NO VERIFICADO.

El panel (`src/web`) solo arrastra 4 módulos de Netfix (11 883 bytes de 127 294).

## 5. Inventario de consumidores del submódulo

### 5.1 Código de producto

| Fichero | Depende de |
|---|---|
| `src/worker/netfix.ts:6-16` | 8 módulos de `vendor/netfix/src` (sección 4) |
| `src/web/core/assignment.ts:6` | `i18n/es-ES/labs.ts` (`LABS_ES`: títulos de los laboratorios; los ids deben coincidir con los de `EXAMPLES` del Worker) |
| `src/web/core/policy.ts:6-7` | `classroom/restrictions.ts` (`DEVICE_KINDS`, `NO_RESTRICTIONS`, `parseRestrictions`, tipo `Restrictions`), tipo `DeviceKind` de `net/topology.ts` |
| `src/web/core/checks.ts:6` | `classroom/checklist.ts` (`parseChecklist`, tipos `Check`, `ChecklistItem`) |
| `src/web/ui/netfix.ts` | `window.netfix` dentro del iframe; rutas `/netfix/embed`, `/netfix/lab` |
| `src/web/views/attempt.ts`, `src/web/ui/base-topology.ts`, `src/web/ui/submission-review.ts`, `src/web/views/netfix.ts` | `netfixFrame` / `NetfixHandle` |
| `public/netfix/embed.html`, `public/netfix/lab.html` | `/netfix/netfix.js`, `styles.css`, `web-admin.css`, `docs.css`, `favicon.png`; `data-embed`; `<body data-mode="realtime">` |
| `public/_headers:9-12` | CSP específica de `/netfix/*` |
| `public/app.css:211` | `.netfix-frame` |

Consumidores indirectos (a través de `src/worker/netfix.ts`): `routes/assignments.ts:15`, `routes/assignment-topology.ts:12`, `routes/attempts.ts:7`, `grading.ts:9`.

### 5.2 Scripts, build y configuración

| Fichero | Depende de |
|---|---|
| `scripts/vendor-netfix.mjs`, `scripts/vendor-netfix.d.mts` | rutas internas del submódulo (sección 3.1) |
| `package.json` | scripts `vendor:netfix`, `build:web`, `check`, `dev` |
| `wrangler.toml` | `[build] command = "npm run build:web"`, `[assets] directory = "./public"` |
| `.gitmodules`, `.gitignore` | declaración del submódulo; `public/netfix/*` ignorado salvo `*.html` |
| `tsconfig.json`, `src/web/tsconfig.json`, `tests/tsconfig.json` | `tsc` comprueba las fuentes `.ts` de Netfix alcanzadas por los imports con la configuración de Classroom (`allowImportingTsExtensions`, `erasableSyntaxOnly`, `lib` `WebWorker` sin DOM en el Worker) |

### 5.3 Workflows

`.github/workflows/ci.yml`: `submodules: true` en los jobs `check`, `staging` y `production`; paso «Versión de Netfix» (lee la URL de `.gitmodules`, compara el último tag `v*` remoto con `git -C vendor/netfix rev-parse HEAD` y emite un aviso sin fallar). Es el único workflow.

### 5.4 Tests

| Fichero | Depende de |
|---|---|
| `tests/worker/assignments.test.ts:6`, `attempts.test.ts:6`, `grading.test.ts:6`, `exam-integrity.test.ts:6` | `EXAMPLES` de `net/examples.ts` como fixtures de topología |
| `tests/web/assignment.test.ts:99` | `EXAMPLES` (import dinámico) frente a `LABS` |
| `tests/web/policy.test.ts:4` | `NO_RESTRICTIONS`, `parseRestrictions` |
| `tests/web/checks.test.ts:4` | `parseChecklist` |
| `tests/web/html.test.ts:54-73` | `FILES` de `scripts/vendor-netfix.mjs`, las páginas `public/netfix/*.html`, la CSP de `/netfix/*` |
| `tests/legal.test.ts:18-20` | **afirma el contenido de `.gitmodules`** y lee `vendor/netfix/LICENSE.md` (espera «GPL») |

Los tests se ejecutan con `node --test` sobre `.ts` (eliminación de tipos de Node), así que importan las fuentes `.ts` de Netfix sin compilar. No hay pruebas E2E ni Playwright en el repositorio (`package.json` no los declara).

### 5.5 Documentación

`README.md:20,26`, `CLAUDE.md:27`, `docs/PLAN.md:200-203,455-470,489,533-547`, `NOTICE.md:3-13` (doble licencia), `docs/DECISIONES.md` D16 («Netfix se sirve desde `/netfix/`»).

## 6. Entidades y persistencia de Classroom

### 6.1 D1 (binding `DB`, `migrations/`)

| Tabla | Columnas relevantes | Migración |
|---|---|---|
| `assignments` | `base_topology_key` (clave R2 o NULL), `restrictions` (JSON tal como lo envió el profesor), `checklist` (JSON en forma normal de Netfix), `kind`, `opens_at`, `closes_at`, `duration_ms`, `max_attempts`, `published`; `results_published`, `results_details`; `category_id`, `weight` | `0001`, `0004`, `0012` |
| `attempts` | `assignment_id`, `student_id`, `n`, `started_at`, `due_at`, `status` (`open`/`submitted`/`collected`/`graded`); índice único parcial `attempts_one_open`; `browser_hash` | `0001`, `0011` |
| `submissions` | `attempt_id`, `topology_key` (R2), `sha256`, `submitted_at`, `origin` (`student`/`auto`), `final`; índice único parcial `submissions_one_final` | `0001` |
| `results` | `submission_id` (PK), `items` (JSON de `Evaluation.items`), `auto_score`, `adjustments`, `comments`, `final_score`, `published`; `graded_at`, `error` | `0001`, `0004` |
| `attempt_events` | `attempt_id`, `kind`, `at` (integridad de examen; no toca topologías) | `0011` |
| `audit_log` | acciones `attempt.start`, `attempt.submit`, `attempt.collect` (detalle = sha256), `attempt.release`, `assignment.topology`, `result.adjust`, `result.publish`, `result.regrade` | `0001` |
| `rate_counters` | cuotas `sim:<profesor>` (30 por ventana), `save:<alumno>` (200), `regrade:<tarea>` (3), `event:<alumno>` | `0003`; `src/worker/ratelimit.ts:23`, `routes/attempts.ts:17`, `routes/results.ts:21` |
| `licenses.product` | admite `'netfix'` como módulo | `0008` |

**No hay ninguna columna de versión de motor, de esquema de topología ni de versión de evaluación** en `submissions`, `results` ni `assignments` (revisadas las 13 migraciones).

### 6.2 R2 (binding `TOPOLOGIES`, bucket `fixit-topologies`, jurisdicción UE)

Siempre texto JSON con `contentType: application/json`, máximo 2 MB (`MAX_TOPOLOGY`, `src/worker/topologies.ts:8`).

| Clave | Contenido | Escrita por | Borrada por |
|---|---|---|---|
| `assignments/<aid>/base-<uuid>.json` | topología base, en la forma guardada de Netfix | `replaceBase` (`topologies.ts:37-50`); clave nueva por versión | al sustituirla, quitarla o borrar la tarea |
| `attempts/<id>/autosave.json` | último autoguardado, **tal como lo envió el navegador** (validado, no normalizado) | `autosave` (`routes/attempts.ts:132-148`) | al cerrar el intento (`submissions.ts:69`) |
| `attempts/<id>/submission-<uuid>.json` | entrega congelada; su SHA-256 se calcula en el servidor sobre `JSON.stringify(file)` | `closeAttempt` (`submissions.ts:43-72`) | solo si pierde la carrera de cierre |

### 6.3 Rutas (`src/worker/index.ts:38-113`)

| Método y ruta | Acceso | Handler | Netfix |
|---|---|---|---|
| `POST /api/classes/:id/assignments` | teacher-active | `createAssignment` | `checkRestrictions`, `checkChecklist`, `labFile` |
| `PATCH /api/assignments/:aid` | teacher-active | `updateAssignment` | ídem + `samePolicy` |
| `GET` / `PUT` / `DELETE /api/assignments/:aid/topology` | teacher / teacher-active | `routes/assignment-topology.ts` | `PUT`: `checkTopology` (simula) |
| `POST /api/assignments/:aid/try` | teacher-active | `tryChecklist` | `mark` en la propia petición |
| `POST /api/assignments/:aid/attempts` | student | `startAttempt` | — (programa el reloj) |
| `GET /api/attempts/:id` | student | `getAttempt` | devuelve `restrictions` |
| `GET /api/attempts/:id/topology` | student | `attemptTopology` | — |
| `PUT /api/attempts/:id/autosave` | student | `autosave` | `checkSavedFile` + `checkPolicy` (sin simular) |
| `POST /api/attempts/:id/submit` | student | `submit` | ídem si el cuerpo trae `topology` |
| `POST /api/assignments/:aid/regrade` | teacher-active | `regrade` | encola todas las entregas finales |
| `GET /api/assignments/:aid/results`, `PATCH /api/submissions/:sid/result`, `POST .../results/publish` | signed / teacher-active | `routes/results.ts` | — |
| `GET /api/submissions/:sid/topology` | teacher | `submissionTopology` | — |

`GET /api/health` devuelve `module: 'netfix'` y `APP_VERSION`, no la versión de Netfix (`src/worker/routes/health.ts:16`).

### 6.4 Servicios, colas, Durable Object y cron

- **Servicios:** `topologies.ts` (R2), `submissions.ts` (congelado, hash, cierre atómico por lote D1), `grading.ts` (corrección y nota), `collect.ts` (recogida al vencer), `netfix.ts` (adaptador).
- **Cola `fixit-grading`** (binding `GRADING`; `max_batch_size = 1`, `max_retries = 3`, DLQ `fixit-grading-dlq`; `wrangler.toml`). Mensaje `{ submissionId }`. El consumidor (`index.ts:196-216`) llama a `gradeSubmission`, que lee la entrega de R2 y la corrige con **el checklist actual de la tarea**; un error de Netfix (400) deja nota 0 con el motivo; tras el último reintento, resultado `internal`. Una ejecución con `graded_at` más antiguo no pisa una más nueva (`grading.ts:65-72`).
- **Durable Object `AttemptClock`** (`src/worker/do/attempt-clock.ts`): alarma en `due_at + 30 s` que recoge el intento con su último autoguardado.
- **Cron `*/5 * * * *`** (`index.ts:218-223`): `collectOverdue`, `requeueUngraded` (entregas finales sin resultado tras 10 minutos) y purga de `email_tokens`.

### 6.5 Flujo de autoguardado, entrega y corrección

1. `onChange` de Netfix → `Autosaver.change()` (`src/web/core/autosave.ts`): envía 5 s después del último cambio, nunca más de 20 s tras el primero; reintentos 10/20/40/60 s; 401/402/403/404/409 lo detienen, 400/413 lo marcan como rechazado.
2. `PUT /autosave` con `exportTopology()` → validación de estructura, presupuesto y política → R2.
3. Entrega (`POST /submit`) o recogida (reloj o cron) → `closeAttempt` congela en R2, lote D1 (cerrar intento, insertar `submissions`, auditar) y encola.
4. Cola → `mark` → `results` y `attempts.status = 'graded'`.

Al salir de la página, el panel conserva `exportTopology()` en `live.frozen` antes de `destroy()` para que el último guardado termine sin Netfix (`src/web/views/attempt.ts:111-124`).

## 7. Qué se rompe o debe cambiar al sustituir el submódulo por un paquete

### 7.1 Fase 4 (dependencia y build)

| # | Qué | Por qué |
|---|---|---|
| 1 | 11 símbolos de 8 módulos internos deben ser exports públicos | `src/worker/netfix.ts` y `src/web/core/*` importan rutas internas, incluidas `net/examples.ts`, `net/network.ts`, `net/topology-file.ts`, `classroom/budget.ts` e `i18n/es-ES/labs.ts`, que no son contratos declarados |
| 2 | El paquete debe traer **JavaScript compilado y `.d.ts`** | Los tests importan el Worker con eliminación de tipos de Node, que no se aplica a ficheros dentro de `node_modules`. Hoy funciona porque `vendor/` no es `node_modules`. NO VERIFICADO con una instalación real |
| 3 | `WorkLimitError` y las clases de `Topology` deben existir **una sola vez** entre subpaths | `netfix()` usa `instanceof` y `constructor === Error`; clases duplicadas por subpath convierten 400 en 500 |
| 4 | El paquete debe publicar el bundle de navegador (o su entrada), las 3 CSS y el favicon | `vendor-netfix.mjs` los toma de rutas internas (`src/ui/main.ts`, `src/ui/*.css`, `assets/brand/favicon.png`) |
| 5 | `scripts/vendor-netfix.mjs` y `.d.mts` deben reescribirse conservando `FILES` | `tests/web/html.test.ts` importa `FILES` |
| 6 | `tests/legal.test.ts:18-20` falla al quitar `.gitmodules` | afirma la URL del submódulo y lee `vendor/netfix/LICENSE.md` |
| 7 | 7 tests usan `EXAMPLES`, `parseRestrictions`, `parseChecklist` como fixtures | necesitan los mismos exports o un corpus propio |
| 8 | CI: tres `submodules: true` y el paso «Versión de Netfix» | sustituir por autenticación de solo lectura al registro y una comprobación de versión del paquete |
| 9 | `.gitignore`, `README.md`, `CLAUDE.md`, `docs/PLAN.md`, `NOTICE.md` | describen el submódulo |
| 10 | Desfase de versión | el submódulo está en `v0.31.0`; Netfix `5c7b3e9` va 84 commits por delante, con cambios en `net/topology.ts` y en un mensaje de `classroom/evaluate.ts`. El primer paquete no será el código que Classroom prueba hoy |

### 7.2 Fase 5 (Worker)

- La corrección en servidor **ya existe**; lo que falta es **trazabilidad**: no hay dónde guardar la versión del motor (sección 6.1). Requiere migración D1 nueva (decisión pendiente: columnas en `results`, en `submissions` o en ambas).
- `regrade` y `requeueUngraded` corrigen con el motor y el checklist **actuales**: una recorrección tras actualizar el paquete puede cambiar notas ya publicadas sin dejar rastro de la versión anterior.
- El Worker carga casi todo Netfix (449 módulos, 1,98 MB minificado). Un subpath «core + evaluación» solo reduce el bundle si `evaluate` deja de arrastrar `i18n`, `docs`, `editors` y `labs`. Límites de tamaño y CPU de Workers: NO VERIFICADO.
- `tryChecklist`, `putBaseTopology` y `createAssignment` con `lab` simulan **dentro de la petición HTTP** (limitadas por `sim:`), no en la cola.
- `EMPTY_TOPOLOGY` con `version: 2` escrito a mano en dos ficheros: debe salir del paquete.
- Los mensajes de error de Netfix llegan al cliente y `src/web/core/text.ts:35` los traduce por texto literal (`'lab: unknown'` es de Classroom; los de Netfix pasan tal cual). Un cambio de redacción en Netfix cambia lo que lee el profesor.
- El autoguardado se guarda sin normalizar; la entrega recogida automáticamente congela ese mismo fichero.

### 7.3 Fase 6 (frontend sin iframe)

- **No hay `postMessage` que eliminar**; lo que se retira es el acceso a `contentWindow.netfix` y las páginas `embed.html` y `lab.html`.
- `installApi` define `globalThis.netfix` no configurable y lanza si se carga dos veces (`embed.ts:66-70`); `main.ts:397-398` arranca solo si encuentra `#app` sin `data-embed`. Montado en la página anfitriona hace falta una API de montaje sin efectos al importar. `public/index.html` no tiene `#app` (usa `topbar`, `main`, `notice`, `view`), así que hoy no chocaría, pero es frágil.
- **CSS global:** `styles.css` de Netfix define `:root`, `html, body`, `body { background; font }`, `button, input, select` y selectores `body[data-view=...]` y `body[data-mode]` (`vendor/netfix/src/ui/styles.css:2,58,67-70,230`). Sin iframe chocan con `public/app.css`. Es el mayor trabajo de la fase 6.
- `destroy()` hace `mount.replaceChildren()` y `forceTimestampPrompt(undefined)` (`main.ts:386-393`); si quedan listeners en `document`/`window` o temporizadores tras `destroy()` es NO VERIFICADO.
- El laboratorio libre usa el almacenamiento del navegador de Netfix (`localStorage` en `vendor/netfix/src/ui/dom.ts`); ya comparte origen con el panel. Qué claves usa: NO VERIFICADO.
- El bundle de 2,1 MB se carga hoy solo al abrir un iframe; nativo, hay que cargarlo con `import()` dinámico para no engordar `app.js` (127 KB).
- CSP: desaparece la regla `/netfix/*` y `frame-src 'self'` puede acotarse a Turnstile; `tests/web/html.test.ts:54-73` hay que reescribirlo.
- No existen E2E: los flujos de profesor y alumno que pide la fase 6 parten de cero.

## 8. Decisiones pendientes para el propietario

1. Qué versión de Netfix será el primer paquete: `v0.31.0` (lo que Classroom prueba hoy) o `main`, y quién valida la diferencia en `net/topology.ts`.
2. Dónde se guarda la versión de motor y de evaluación por resultado, y si una recorrección conserva el resultado anterior.
3. Si `EXAMPLES` y `LABS_ES` son API pública del paquete o Classroom pasa a tener su propio catálogo de laboratorios.
4. Si el laboratorio libre (`lab.html`) se mantiene como página aparte o también se monta nativo.
5. Estrategia de aislamiento de CSS sin iframe (prefijo, `@scope`, Shadow DOM): condiciona el trabajo en Netfix de la fase 6.

## 9. No verificado

- Suite de Classroom contra Netfix `5c7b3e9`.
- Tamaño del Worker tal como lo empaqueta Wrangler; CPU y memoria por corrección.
- Comportamiento de Node al importar un paquete que solo traiga `.ts`.
- Limpieza completa de listeners y temporizadores en `destroy()`.
- Estado real de D1 y R2 en staging y producción (`docs/PLAN.md:468-470` dice que no hay tareas desplegadas; no se ha consultado ninguna base remota).
- Permisos de GitHub Packages y encaje de licencia (fuera del alcance de este documento).
