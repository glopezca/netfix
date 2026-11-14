# RISKS — riesgos, decisiones pendientes y desglose en PR (Fase 0)

> **Revalidado en `6e7c887` (`0.47.0`):** ver `README.md`; las cifras de `5c7b3e9` siguen valiendo salvo lo allí indicado.

> **Tipo:** auditoría y diseño (Fase 0, tareas 10 y 11 de `NETFIX-MIGRATION-ECC.md`). No modifica código de producto.
> **Netfix:** `origin/main` @ `5c7b3e9` (`0.46.0`). **FixITClassroom:** `main` @ `d443d98`; submódulo `vendor/netfix` @ `4985c8c` (`v0.31.0`).
> **Fuente:** consolida, sin repetir la evidencia, [`CORE.md`](CORE.md), [`DEPENDENCY-MAP.md`](DEPENDENCY-MAP.md),
> [`PUBLIC-API.md`](PUBLIC-API.md), [`CLASSROOM-CONSUMPTION.md`](CLASSROOM-CONSUMPTION.md) y [`PACKAGING.md`](PACKAGING.md).
> Cada fila remite a la sección donde está la prueba. Lo no comprobado se marca **NO VERIFICADO**.

## 1. Registro de riesgos

Probabilidad (P) e impacto (I): A alto, M medio, B bajo.

### 1.1 Licencia y publicación

| # | Riesgo | P | I | Mitigación | Fase | Fuente |
|---|---|---|---|---|---|---|
| R1 | Distribuir Netfix (`GPL-3.0-or-later`) dentro del producto privativo sin base jurídica cerrada: la doble licencia (D1 de Classroom) sigue «pendiente de revisión jurídica» | M | A | No publicar hasta resolver L1–L6; revisión jurídica antes de la Fase 3 | 3 | `PACKAGING.md` §3 |
| R2 | Titularidad del código escrito con asistencia de IA (141 de 243 commits con autor `Claude`): la doble licencia exige que el titular tenga todos los derechos | M | A | Decisión del propietario y revisión jurídica | 3 | `PACKAGING.md` §3 |
| R3 | Repositorio canónico ambiguo: `package.json` y `LICENSE.md` apuntan al espejo `infogerman/netfix`, actualizado por force-push con `INFOGERMAN_SYNC_TOKEN` | A | M | Fijar `glopezca/netfix` como canónico antes de publicar; decidir el destino del espejo | 3 | `PACKAGING.md` §1.1, §1.5 |

### 1.2 Arquitectura y extracción

| # | Riesgo | P | I | Mitigación | Fase | Fuente |
|---|---|---|---|---|---|---|
| R4 | El modelo de topología no es separable del motor: `Topology` arrastra prácticamente todo `src/` fuera de `ui` | A | M | Aceptar «Core = todo menos `ui`» en la Fase 1; partir el motor solo si el bundle lo exige | 1 | `CORE.md` §2; `DEPENDENCY-MAP.md` V1–V4 |
| R5 | Ciclo de 11 directorios y `net` importando capas altas: mover código rompe con facilidad | A | M | Sin movimientos masivos; extraer por entradas y reglas de importación comprobadas por herramienta | 1 | `DEPENDENCY-MAP.md` V2, V3 |
| R6 | `classroom/embed.ts` mezcla contrato puro y DOM (`:35,56,57`), único uso real de DOM fuera de `ui` | A | B | Paso 2 de la Fase 1: mover `checkMount`/`installApi` a `ui` | 1 | `CORE.md` §3.1, §4 |
| R7 | `ui/main.ts` tiene efectos al importar e instancia única: bloquea el montaje sin iframe | A | A | Separar «definir» de «arrancar» antes de la Fase 6 | 1/6 | `PUBLIC-API.md` B1; `CORE.md` paso 6 |
| R8 | Clases duplicadas entre subpaths (`WorkLimitError`, `Topology`) convierten errores 400 en 500 (`instanceof`) | M | A | Publicar JS compilado sin empaquetar por subpath; prueba de identidad de clases | 3 | `CLASSROOM-CONSUMPTION.md` §7.1.3; `PACKAGING.md` §2.3 |

### 1.3 Runtime de Workers

| # | Riesgo | P | I | Mitigación | Fase | Fuente |
|---|---|---|---|---|---|---|
| R9 | El límite de 4 s del intérprete bash no salta en Workers (el reloj no avanza durante la CPU) | A | A | Corte por número de pasos (Fase 1, paso 5) | 1 | `DEPENDENCY-MAP.md` §5.2; `CORE.md` paso 5 |
| R10 | Bundle del Worker grande: 1,98 MB minificado, 449 de 497 módulos son de Netfix; `evaluate` arrastra `docs`, `i18n`, `editors`, `labs`. Límite del plan contratado y CPU de arranque **NO VERIFICADO** | M | A | Medir con Wrangler; cortar V5/V6 si supera el límite | 5 | `CLASSROOM-CONSUMPTION.md` §4; `DEPENDENCY-MAP.md` §5.1 |
| R11 | Ninguna prueba en `workerd` desde `0.31.0`: que `0.46.0` cargue y corrija en Workers es **NO VERIFICADO** | M | A | Prueba de humo en `workerd` en CI de Netfix (Fase 3) | 3 | `DEPENDENCY-MAP.md` §4; `PACKAGING.md` §5.3 |
| R12 | Datos de idioma de `Intl` (`es-ES`/`en-GB`) en Workers **NO VERIFICADO** | B | M | Incluir en la prueba de humo de `workerd` | 3 | `DEPENDENCY-MAP.md` §4 |
| R13 | Estado global de módulo (`i18n/locale.ts`, registros por efecto de carga) compartido entre peticiones en un isolate reutilizado | M | M | Fijar idioma por llamada (`withLocale`); prueba de dos peticiones intercaladas | 5 | `DEPENDENCY-MAP.md` V9, §5.4; `CORE.md` §3.4 |

### 1.4 Datos, compatibilidad y reproducibilidad

| # | Riesgo | P | I | Mitigación | Fase | Fuente |
|---|---|---|---|---|---|---|
| R14 | Sin versión de motor ni de evaluación en `Evaluation` ni en D1: las notas históricas no son auditables | A | A | Metadatos de runtime (Fase 2) y columnas D1 (Fase 7) | 2/7 | `PUBLIC-API.md` B2; `CLASSROOM-CONSUMPTION.md` §6.1 |
| R15 | `regrade` y `requeueUngraded` corrigen con el motor actual: una recorrección tras actualizar el paquete cambia notas publicadas sin rastro | A | A | Registrar versión por resultado; política de recorrección decidida antes de la Fase 4 | 5/7 | `CLASSROOM-CONSUMPTION.md` §7.2 |
| R16 | No determinismo: reloj de pared en `Topology`/`SimClock` y aleatoriedad en VPN/SSH al cargar. Determinismo medido solo en 3 misiones sin VPN | M | A | Reloj inyectable (Fase 1, paso 4); prueba de determinismo con laboratorio VPN antes de GATE 2 | 1/2 | `PUBLIC-API.md` B3, §5; `CORE.md` paso 4 |
| R17 | Deriva de versión: Classroom prueba `v0.31.0` y el primer paquete será `≥0.46.0` (`net/topology.ts` cambió); un archivo guardado con la versión nueva pierde campos si lo normaliza la antigua | A | M | Ejecutar la suite de Classroom contra `main` antes de la Fase 4; navegador y Worker en la misma versión | 4 | `PUBLIC-API.md` §4.4; `CLASSROOM-CONSUMPTION.md` §7.1.10 |
| R18 | Los textos de Netfix llegan al profesor y Classroom los traduce por texto literal: cambiar la redacción cambia lo que se lee. Ejemplo real en `496a092..5c7b3e9`: `evaluate.ts` pasó de «por /etc/hosts» a «por el fichero hosts» | A | B | Códigos de error tipados (D2) o pruebas de contrato de mensajes | 2 | `CLASSROOM-CONSUMPTION.md` §7.2; `CORE.md` §0 |
| R19 | Corpus de compatibilidad mínimo (9 fixtures v0.1); faltan fixtures de las versiones con datos reales en Classroom | A | M | Ampliar el corpus (D4: muestra de R2 si se autoriza) | 2 | `PUBLIC-API.md` §4.3; `PACKAGING.md` §5 |
| R20 | El autoguardado se guarda sin normalizar y la entrega automática congela ese fichero | M | M | Revalidar en servidor (Fase 5, tarea 5) | 5 | `CLASSROOM-CONSUMPTION.md` §7.2 |

### 1.5 CI, cadena de suministro y seguridad

| # | Riesgo | P | I | Mitigación | Fase | Fuente |
|---|---|---|---|---|---|---|
| R21 | Netfix sin lockfile: ni `npm ci` ni publicación reproducible | A | M | Añadir `package-lock.json` (P4) | 3 | `PACKAGING.md` §1.1 |
| R22 | Acciones fijadas por versión mayor, no por SHA; `ci.yml` de Netfix sin `permissions` | M | M | Fijar por SHA; `permissions` mínimos por workflow | 3 | `PACKAGING.md` §1.5, §4 |
| R23 | Tags parados en `v0.32.0` con `package.json` en `0.46.0`: el aviso de versión del CI de Classroom compara con un tag antiguo | A | B | Retomar tags; comprobar tag = versión al publicar (P3) | 3 | `PACKAGING.md` §1.1 |
| R24 | GitHub Packages exige token incluso para leer; acceso de `GITHUB_TOKEN` entre repositorios **NO VERIFICADO** | M | M | Acceso explícito al paquete o GitHub App de mínimos privilegios | 3/4 | `PACKAGING.md` §2.1, §4.2 |
| R25 | Sin iframe, la UI de Netfix corre con los privilegios del anfitrión y su CSS global (`src/ui/styles.css`) colisiona con el de Classroom | A | M | Tratarla como código de confianza; aislar CSS (`@scope`/prefijo/Shadow DOM); autorización solo en servidor | 6 | `PUBLIC-API.md` D5; plan, Fase 6 |
| R26 | Limpieza de listeners y temporizadores en `destroy()` **NO VERIFICADO**: fugas al montar y desmontar varias veces | M | M | Prueba de montaje/desmontaje repetido (Fase 6) | 6 | `CLASSROOM-CONSUMPTION.md` §7.3 |
| R27 | e2e (Playwright) fuera de CI: regresiones del standalone pueden pasar inadvertidas al extraer | M | M | Ejecutar un subconjunto de e2e en CI antes de GATE 1 | 1 | `PACKAGING.md` §5.1 |
| R28 | Ruta de ficheros de Windows: desde `0.47.0` C:\ es `/mnt/c` (antes `/`). Un laboratorio guardado antes lleva el hosts de Windows en `/Windows/…`; Netfix ≥0.47 lo migra y lo lee, pero un motor `<0.47` (el Worker de Classroom en `v0.31.0`) no ve los ficheros guardados en `/mnt/c` | M | B | Mismo motor en navegador y Worker (R17); caso de prueba de compatibilidad con un laboratorio `0.46` y otro `0.47` en el corpus (Fase 3) | 3 | `shells/hosts-file.ts` (`LEGACY_WINDOWS_HOSTS`); `README.md` (revalidación en `6e7c887`) |

## 2. Decisiones pendientes del propietario

Bloquean la fase indicada. Se recogen de cada documento; la discusión está en la fuente.

| # | Decisión | Bloquea | Fuente |
|---|---|---|---|
| G0 | Aprobar esta auditoría (GATE 0) y la frontera «Core = todo menos `src/ui`» | Fase 1 | `CORE.md` §2 |
| L1–L6 | Licencia: revisión jurídica de D1, titularidad del código asistido por IA, licencia de `src/docs` (GPL o CC BY-SA), autorización de publicación | Fase 3 | `PACKAGING.md` §3 |
| P1 | Registro: GitHub Packages (recomendado), tarball en Release o npm público | Fase 3 | `PACKAGING.md` §6 |
| P2 | Repositorio canónico y destino del espejo `infogerman` | Fase 3 | `PACKAGING.md` §6 |
| P3 | Versión del primer paquete y retomar tags | Fase 3 | `PACKAGING.md` §6; `CLASSROOM-CONSUMPTION.md` §8.1 |
| P4 | Lockfile en Netfix; Playwright y `workerd` como `devDependencies` | Fase 3 | `PACKAGING.md` §6 |
| P5 | Excepción escrita a la regla «sin reexportaciones» para los ficheros de entrada del paquete | Fase 1 (paso 3) | `PACKAGING.md` §6; `CORE.md` paso 3 |
| D1 | `version` actual como `topologySchemaVersion` (recomendado) o campo `schemaVersion` nuevo | Fase 2 | `PUBLIC-API.md` §6 |
| D2 | Errores tipados en la API pública o `Error` + mensaje | Fase 2 | `PUBLIC-API.md` §6 |
| D3 | `saveTopology`/`loadTopology` frente a `Topology.fromJSON`/`toJSON` | Fase 2 | `PUBLIC-API.md` §6 |
| D4 | Autorizar una muestra de entregas reales de R2 como corpus de regresión | Fase 2 | `PUBLIC-API.md` §6 |
| C2 | Dónde se guarda la versión de motor y evaluación por resultado; si una recorrección conserva el resultado anterior | Fase 5/7 | `CLASSROOM-CONSUMPTION.md` §8.2 |
| C3 | Si `EXAMPLES` y `LABS_ES` son API pública o Classroom tiene catálogo propio | Fase 2 | `CLASSROOM-CONSUMPTION.md` §8.3 |
| C4 | Si `lab.html` (laboratorio libre) sigue como página aparte o se monta nativo | Fase 6 | `CLASSROOM-CONSUMPTION.md` §8.4 |
| C5 | Estrategia de aislamiento de CSS sin iframe | Fase 6 | `CLASSROOM-CONSUMPTION.md` §8.5; `PUBLIC-API.md` D5 |

## 3. Desglose en PR de las fases siguientes

Esfuerzo: S ≤ 1 día, M 2–3 días, L ≥ 1 semana (estimación orientativa de un agente con revisión humana). Riesgo según §1.
Cada PR sigue TDD y `npm run check`; ninguno cruza un GATE sin aprobación.

### Fase 1 — Core (Netfix)

| PR | Contenido | Esfuerzo | Riesgo | Riesgos que cierra |
|---|---|---|---|---|
| 1.1 | Pruebas de caracterización: `validateFile` directo, exports que importa Classroom, determinismo de carga, límite de bash (`CORE.md` paso 0) | M | B | R16 (medición), R17 |
| 1.2 | `tsconfig` del Core sin `DOM` + declaración ambiental de globales web + comprobación de reglas de importación (paso 1) | S | B | V11, R5 |
| 1.3 | Separar `classroom/embed.ts`: `checkMount`/`installApi` a `ui` (paso 2) | S | M | R6 |
| 1.4 | Entrada del Core y prueba de importación en Node (paso 3; requiere P5) | S | M | V10 |
| 1.5 | Reloj inyectable en `Topology` (paso 4) | M | M | R16 |
| 1.6 | Corte de bash por pasos, independiente de la hora (paso 5) | M | A | R9 |
| 1.7 | Subconjunto de e2e en CI | S | B | R27 |
| 1.8 | (opcional; obligatorio antes de la Fase 6) Separar «definir» de «arrancar» en `ui/main.ts` (paso 6) | M | A | R7 |

### Fase 2 — Contratos y esquema (Netfix)

| PR | Contenido | Esfuerzo | Riesgo | Riesgos que cierra |
|---|---|---|---|---|
| 2.1 | `NetfixRuntimeInfo` (versión de motor, commit, esquema, evaluación) en `Evaluation` | S | M | R14 (parte Netfix) |
| 2.2 | Esquema versionado según D1 y política de errores de formato (D2) | M | M | R18 |
| 2.3 | Corpus de compatibilidad ampliado y pruebas de round-trip y migración, incluidos JSON de `netsim` | M | M | R19 |
| 2.4 | Prueba de determinismo con laboratorio VPN | S | M | R16 |
| 2.5 | Contratos públicos documentados (`topology`, `classroom`, `ui`, `metadata`) según `PUBLIC-API.md` §3 | M | B | — |

### Fase 3 — Paquete (Netfix)

| PR | Contenido | Esfuerzo | Riesgo | Riesgos que cierra |
|---|---|---|---|---|
| 3.1 | Lockfile, `repository` canónico, retomar tags | S | B | R3, R21, R23 |
| 3.2 | Emitir `.d.ts`; `exports`/`types`/`files`/`publishConfig` (`PACKAGING.md` §2.2) | M | M | R8 |
| 3.3 | Pruebas de importación del paquete empaquetado (`npm pack`) e identidad de clases | S | M | R8 |
| 3.4 | Prueba de humo en `workerd` | M | M | R11, R12 |
| 3.5 | Workflow de publicación desde tags, `permissions` mínimos, acciones por SHA; publicación de prueba solo con autorización | M | A | R22, R24 |

### Fases 4–9 — Classroom (resumen; se detallan al aprobar GATE 3)

| PR | Contenido | Esfuerzo | Riesgo |
|---|---|---|---|
| 4.1 | Suite de Classroom contra Netfix `main` (aún por submódulo) para medir la deriva | S | M |
| 4.2 | Acceso de lectura al registro; dependencia con versión exacta; lockfile | S | M |
| 4.3 | Importaciones a exports públicos; reescribir `vendor-netfix.mjs` conservando `FILES`; adaptar los 7 tests y `tests/legal.test.ts` | M | M |
| 4.4 | CI sin `submodules: true`; comprobación de versión del paquete | S | B |
| 5.1 | Adaptador Worker con subpaths; medición de bundle, CPU y memoria | M | A |
| 5.2 | Revalidación en servidor de autosave y entrega; idempotencia y concurrencia | M | A |
| 5.3 | Pruebas negativas de autorización (IDOR/BOLA, otra clase/organización, manipulación de nota) | M | A |
| 6.1 | API de montaje/destrucción e integración nativa; aislamiento de CSS (C5) | L | A |
| 6.2 | Adaptador HTTP, estados de carga/guardado/entrega, CSP, e2e de profesor y alumno | L | A |
| 7.1 | Migración D1 expand-and-contract para versión de motor por resultado (C2); política de recorrección | M | A |
| 8.1 | Netfix Sync: detección, informe y PR (sin merge automático) | L | M |
| 9.1 | Retirada del submódulo, `embed.html`/`lab.html` sin consumidores, rollback documentado | M | M |

## 4. No verificado (consolidado)

- `npm run e2e` (y, en `5c7b3e9`, `npm test` completo y `npm run build`; en `6e7c887` `npm run check` pasa) (solo 75 pruebas de `classroom`, `compat`, `labs` y `core`, todas pasan; `CORE.md` §0).
- Ejecución de Netfix `≥0.32.0` en `workerd`; datos de `Intl` en Workers.
- Tamaño del Worker empaquetado por Wrangler frente al límite del plan contratado; CPU y memoria por corrección.
- Generación de `.d.ts` con la configuración actual; comportamiento de Node con un paquete que solo traiga `.ts`.
- Acceso de `GITHUB_TOKEN` a GitHub Packages entre repositorios.
- Estado de D1 y R2 en staging y producción (no se ha consultado ninguna base remota).
- Limpieza de `destroy()`; claves de `localStorage` del laboratorio libre.
- Suite de Classroom contra Netfix `main`.
