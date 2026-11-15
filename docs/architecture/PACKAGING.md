# PACKAGING (Fase 0): estado inicial, empaquetado, licencia, CI y pruebas

> **Revalidado en `6e7c887` (`0.47.0`):** ver `README.md`; las cifras de `5c7b3e9` siguen valiendo salvo lo allí indicado.

> **Tipo:** auditoría y diseño (Fase 0 de `NETFIX-MIGRATION-ECC.md`: entregable `PACKAGING.md`, «Plan de pruebas y corpus de regresión», riesgos de licencia). No modifica código de producto.
> **Fecha:** 2026-11-13.
> **Netfix:** rama `docs/phase0-architecture` = `origin/main` @ `5c7b3e9` (`5c7b3e915174696459ce4a65f840c24af84b79f5`). Sin seguimiento en git: `docs/architecture/`, `graphify-out/`, `.claude-flow/`, `.swarm/`.
> **FixITClassroom:** `main` @ `d443d98`. Sin seguimiento en git: `graphify-out/`. Submódulo `vendor/netfix` @ `4985c8c` (`v0.31.0`).
> **Documentos relacionados:** `DEPENDENCY-MAP.md`, `PUBLIC-API.md` y `CLASSROOM-CONSUMPTION.md` (auditados en `496a092`; de `496a092` a `5c7b3e9` solo cambia el trabajo de nombres de equipo). Aquí se citan sin repetirlos.
> Todo lo que no se ha comprobado lleva la marca **NO VERIFICADO**. No se imprime el valor de ningún secreto; solo su nombre.

## 0. Resumen

- Hoy Netfix **no es un paquete**: `private: true`, sin `exports`, `main`, `types` ni `files`, y sin lockfile. Ya tiene un build que emite **ESM sin empaquetar** (`tsconfig.build.json` → `dist/js`, con `rewriteRelativeImportExtensions`). Ese build es la base natural del paquete. Le falta emitir `.d.ts`.
- **Los tags están parados.** El último es `v0.32.0`, pero `package.json` dice `0.46.0`: 14 versiones menores sin tag. Por eso el aviso de CI de Classroom («última versión de Netfix») compara con `v0.32.0`.
- **Recomendación:** seguir el plan con un paquete único `@glopezca/netfix` en GitHub Packages, publicado solo desde tags revisados con `GITHUB_TOKEN` (§2). Debe llevar **JS compilado + `.d.ts`**, no fuentes `.ts`, sin empaquetar por subpath (§2.3).
- **Licencia:** está documentada la doble licencia (D1 de Classroom, `LICENSE` privativo, `NOTICE.md`, CLA en `CONTRIBUTING.md`), pero D1 sigue «pendiente de revisión jurídica». Hay que decidir la titularidad del código escrito con asistencia de IA (§3). **Decisión pendiente** antes de publicar.
- **Pruebas:** hay 186 ficheros `*.test.ts`, 24 scripts e2e (Playwright global, fuera de CI) y un corpus de compatibilidad mínimo (9 fixtures v0.1). **No hay** pruebas de importación del paquete, ni de ejecución en workerd, ni fixtures de las versiones que Classroom tiene en producción (§5).

## 1. Estado inicial

### 1.1 Repositorios y versiones

| Dato | Netfix | FixITClassroom |
|---|---|---|
| Remoto | `https://github.com/glopezca/netfix` (público) | privado (`glopezca/FixITClassroom`) |
| HEAD auditado | `5c7b3e9` (merge PR #19) | `d443d98` |
| `git describe --tags` | `v0.32.0-82-g5c7b3e9` | `d443d98` (sin tags) |
| Tags | `v0.31.0` (= `4985c8c`, el del submódulo) y `v0.32.0` (anotado → `a879a5d`, 2026-11-04). Los mismos en `origin` | ninguno |
| `package.json` `name` / `version` | `netfix` / `0.46.0` | `fixit-classroom` / `0.2.0` |
| `private` / `license` | `true` / `GPL-3.0-or-later` | `true` / `UNLICENSED` |
| `type` / `engines` | `module` / `node >=22.18` | `module` / `node >=22.18` |
| `repository` | `git+https://github.com/infogerman/netfix.git` (**no** es `glopezca`) | no tiene |
| `exports`, `main`, `types`, `files`, `publishConfig` | no tiene | no tiene |
| Dependencias | ninguna; `devDependencies`: `typescript ^5.8.0` (instalada 5.9.3) | ninguna; `devDependencies`: `@types/node ^22.20.5`, `esbuild ^0.28.2`, `typescript ^5.8.0`, `wrangler ^4.0.0` |
| Lockfile | **no hay** (`package-lock.json` ausente) | `package-lock.json` |
| Node local | v22.23.4 | ídem |

### 1.2 Scripts de Netfix (`package.json`)

| Script | Qué hace |
|---|---|
| `test` | `node --test "tests/**/*.test.ts"` (eliminación de tipos nativa) |
| `test:coverage` | ídem, con cobertura de `src/**` sin `src/ui/**`, y umbrales de líneas 80, ramas 70 y funciones 80 |
| `typecheck` | `tsc -p tsconfig.json` (`noEmit`) |
| `build` | `gen-about` + `gen-brand` + `gen-shots` + `scripts/build.mjs` |
| `check` | `typecheck && test && build` |
| `e2e` | `build` + 24 scripts `scripts/e2e*.mjs` |
| `bench:evaluate` | `scripts/bench-evaluate.ts`: CPU de la corrección por laboratorio |
| `serve`, `site`, `about`, `brand` | servidor local, página pública, ficheros generados |

`scripts/build.mjs` hace esto: `tsc -p tsconfig.build.json` → `dist/js/**.js`; copia `index.html`, las 3 CSS y los iconos; ordena los módulos desde la entrada fija `ui/main.js` (falla si hay ciclos) y escribe `dist/netfix.bundle.js`, `dist/netfix.html` (un solo archivo) y `dist/artifact.html`. **También escribe `demo/netfix-lab.html`, que está versionado**: por eso en esta auditoría no se ha ejecutado `build` ni `check`.

El empaquetador propio solo admite `import {…} from`, `export {…}` y `export function|class|const…`. Con cualquier otra forma lanza `Unsupported import/export form`. Solo transforma lo que alcanza desde `ui/main.js`, así que unos ficheros de entrada del paquete con `export … from` **no lo rompen** si `main.ts` no los importa. Aun así contradicen la regla de `CLAUDE.md` («no admite reexportaciones»): la excepción hay que escribirla.

### 1.3 tsconfig

- `tsconfig.json`: `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `lib [ES2022, DOM, DOM.Iterable]`, `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`, `include src/**/*.ts`.
- `tsconfig.build.json`: extiende el anterior con `noEmit false`, `rewriteRelativeImportExtensions`, `outDir dist/js`, `rootDir src` y sin source maps. **No tiene `declaration`.**
- El `lib` del Core incluye `DOM`. Eso permite que entren en el Core usos del DOM sin que lo detecte el tipado (ver `DEPENDENCY-MAP.md` §4).

### 1.4 Licencias en los ficheros

| Repositorio | Ficheros | Contenido |
|---|---|---|
| Netfix | `LICENSE` | texto de la GPL v3 |
| Netfix | `LICENSE.md` | código (`src/`, `tests/`, `scripts/`, configuración, salida del build) bajo GPL-3.0-or-later; `README.md`, `docs/`, capturas y textos de laboratorios bajo CC BY-SA 4.0; `.claude/` bajo MIT. Cita como repositorio `infogerman/netfix` |
| Netfix | `CONTRIBUTING.md` | «Doble licencia»; solo admite aportaciones con **CLA** (licencia perpetua e irrevocable al titular, sublicenciable bajo cualquier licencia) |
| Classroom | `LICENSE` | privativo, «todos los derechos reservados». Incluye código de Netfix «bajo estos términos privativos (doble licencia)». Los componentes de Netfix hechos para Classroom son privativos |
| Classroom | `NOTICE.md` | atribución de Netfix (GPL/CC BY-SA en público, privativo aquí); fuentes OFL, ECC (MIT) y SecLists (MIT) |
| Classroom | `docs/DECISIONES.md` | D1 «Aceptada, pendiente de revisión jurídica antes de vender»; D2 (submódulo fijado a tags); D12 (elementos privativos de Netfix solo en Classroom) |

### 1.5 Workflows

**Netfix, `.github/workflows/ci.yml`**: se ejecuta en `push` a `main` y en `pull_request`.
- Job `check`: `npm install --no-audit --no-fund` (no `npm ci`: no hay lockfile), `tsc -p tsconfig.json`, `npm run test:coverage`, `tsc -p tsconfig.build.json && node scripts/build.mjs --skip-tsc` y sube `dist/` como artefacto `netfix-dist`. **No ejecuta e2e.**
- Job `pages` (solo `main`): `permissions: pages: write, id-token: write`; entorno `github-pages`; `build-site.mjs` y `deploy-pages@v4` con `continue-on-error: true`.
- **El fichero no declara `permissions` de nivel superior.** El job `check` hereda los permisos por defecto del repositorio: **NO VERIFICADO** (ajuste del repositorio).

**Netfix, `.github/workflows/sync-infogerman.yml`**: se ejecuta en `push` a `main` y con `workflow_dispatch`; `permissions: contents: read`. Usa el secreto `INFOGERMAN_SYNC_TOKEN` (por su uso, un token de otra cuenta u organización: tipo y alcance **NO VERIFICADO**). Mete el token en la URL del remoto y hace `git push … HEAD:refs/heads/main --force` a `infogerman/netfix`. Hay **dos repositorios públicos** con el mismo código, y `package.json` y `LICENSE.md` apuntan al espejo, no al origen.

**Classroom, `.github/workflows/ci.yml`**: `permissions: contents: read` de nivel superior; se ejecuta en `push` a `main`, en tags `v*` y en `pull_request`.
- Job `check`: `checkout` con `submodules: true`, `npm ci`, `npm run check` y el paso «Versión de Netfix» (aviso si el submódulo no está en el último tag `v*`; con el estado de §1.1, eso es `v0.32.0`).
- Jobs `staging` (condición `vars.DEPLOY_STAGING == 'true'`, entorno `staging`) y `production` (tag `v*` + `vars.DEPLOY_PRODUCTION == 'true'`, entorno `production`, exige que el tag pertenezca a `main`). Secretos: `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.

Todas las acciones de los dos repositorios están fijadas por **versión mayor** (`@v4`, `@v3`), no por SHA.

## 2. Opciones de empaquetado

### 2.1 Comparación

| Opción | A favor | En contra |
|---|---|---|
| **A. GitHub Packages (npm, `@glopezca/netfix`)**: la del plan | versiones inmutables por número; `npm ci` con lockfile e integridad; publicación con `GITHUB_TOKEN` (`packages: write`); permisos por paquete; encaja con «publicar desde tags» | instalar exige autenticarse **aunque el paquete sea público**: `.npmrc` con `@glopezca:registry=https://npm.pkg.github.com` y un token. El ámbito del nombre debe coincidir con el propietario (`glopezca`), y `repository` apunta hoy a `infogerman` |
| B. Dependencia git (`github:glopezca/netfix#vX.Y.Z`) | sin registro ni token (el repositorio es público) | instala la fuente: sin `dist/` versionado tendría que compilar en `prepare` (scripts de ciclo de vida en el CI de Classroom); `#tag` es mutable si alguien mueve el tag; el lockfile solo fija el commit |
| C. Tarball adjunto a un GitHub Release (`npm pack`) | artefacto exacto y auditable; sin token para descargarlo si es público; se puede atestar | URL a mano en `package.json`; sin rangos semver ni `npm outdated`; el sincronizador de la Fase 8 tendría que reescribir URLs |
| D. npm público (`registry.npmjs.org`) | sin autenticación al instalar; `npm publish --provenance` (procedencia firmada) | publicación global e irreversible en la práctica (política de despublicación de npm); necesita cuenta y token de npm; el plan no lo contempla. **Requiere decisión explícita** |

**Recomendación: A**, como dice el plan, con tres condiciones:
1. `repository.url` = `glopezca/netfix`. Qué hacer con el espejo `infogerman` es una **decisión pendiente**.
2. Tag `vX.Y.Z` = `package.json` `version`, comprobado en CI.
3. Procedencia con *artifact attestations* de GitHub. `--provenance` es de npmjs; su soporte en GitHub Packages está **NO VERIFICADO**.

C es la alternativa si el propietario no quiere tokens en Classroom. B no se recomienda.

### 2.2 Mapa `exports` propuesto

Usa los nombres de `PUBLIC-API.md` §3. Cada subpath reexporta funciones que ya existen; no se crean firmas nuevas.

```jsonc
{
  "name": "@glopezca/netfix",
  "type": "module",
  "exports": {
    "./topology":  { "types": "./dist/pkg/topology.d.ts",  "default": "./dist/pkg/topology.js" },
    "./classroom": { "types": "./dist/pkg/classroom.d.ts", "default": "./dist/pkg/classroom.js" },
    "./ui":        { "types": "./dist/pkg/ui.d.ts",        "default": "./dist/pkg/ui.js" },
    "./ui/*.css":  "./dist/pkg/assets/*.css",
    "./ui/favicon.png": "./dist/pkg/assets/favicon.png",
    "./package.json": "./package.json"
  },
  "files": ["dist/pkg/", "LICENSE", "LICENSE.md", "README.md"],
  "engines": { "node": ">=22.18" },
  "sideEffects": ["./dist/pkg/ui.js", "./dist/pkg/**/net/topology.js"],
  "publishConfig": { "registry": "https://npm.pkg.github.com" }
}
```

- **Sin `"."` ni comodín `./*`.** Cualquier ruta interna queda cerrada; resuelve V10 de `DEPENDENCY-MAP.md`.
- **`core` y `metadata` quedan fuera de la primera versión.** `PUBLIC-API.md` no define ninguna entrada `core`, y `metadata` (`NetfixRuntimeInfo`) todavía no existe. Se añaden en las Fases 1 y 2 cuando haya código que exportar.
- Los 4 ficheros que copia `vendor-netfix.mjs` (3 CSS + favicon) quedan cubiertos por `./ui/*.css` y `./ui/favicon.png` (`CLASSROOM-CONSUMPTION.md` §7.1 n.º 4).
- `sideEffects`: `net/topology.ts` registra servicios al cargarse, y `ui/main.ts` instala el global (`PUBLIC-API.md` §3.5). Rutas exactas: **NO VERIFICADO** hasta que exista `dist/pkg`.
- Los ficheros de entrada (`src/pkg/*.ts`, nombre propuesto) los compila el mismo `tsc` y no los importa `ui/main.ts`, así que el build standalone no cambia (§1.2).

> **Implementado en PR 3.2 (2026-11-15).** Diferencias con la propuesta: el build del paquete es `tsconfig.pkg.json`
> (`npm run build:pkg`, también en `prepack`) en `dist/pkg/`, así que las entradas están en `dist/pkg/pkg/{topology,classroom,ui}.js`
> y el build standalone no cambia. CSS y favicon se publican desde `src/ui/*.css` y `assets/brand/favicon.png`, sin copia.
> Sin `sideEffects` (por defecto: todo tiene efectos; los registros se llenan al cargar en varios módulos). `private: true`
> se mantiene hasta el PR de publicación (3.5). `src/pkg/core.ts` es la unión de `topology` y `classroom`, sin subpath.
> Comprobado con `npm pack` en un consumidor de prueba: `.d.ts` resuelven con `NodeNext`, `lib ES2022` sin DOM y
> `skipLibCheck: false` (los especificadores `.ts` en los `.d.ts` resuelven); `ui` compila con DOM; rutas internas →
> `ERR_PACKAGE_PATH_NOT_EXPORTED`; tarball 2,6 MB, 627 `.d.ts`. Las pruebas automáticas de esto son el PR 3.3:
> `npm run test:pack` (`scripts/pack-check.mjs`, también en CI) empaqueta, instala el tarball en un consumidor desechable
> en `node_modules/.cache/pack-check` y comprueba contenido, imports en Node, rutas cerradas y los `.d.ts` con `tsc`.

### 2.3 Fuentes TS o JS compilado + `.d.ts`

**JS compilado + `.d.ts`**, por cuatro motivos:
1. Node **no elimina tipos dentro de `node_modules`** (documentado por Node; no se ha ejecutado en esta auditoría). Los tests de Classroom (`node --test` sobre `.ts`) dejarían de cargar Netfix (`CLASSROOM-CONSUMPTION.md` §7.1 n.º 2).
2. Con la sintaxis borrable y los imports `.ts`, `tsc` ya produce ESM válido con extensiones `.js` (`rewriteRelativeImportExtensions`), así que no hace falta un empaquetador nuevo.
3. **No empaquetar cada subpath por separado.** Con módulos sin empaquetar, `topology.js` y `classroom.js` comparten `net/network.js`: `WorkLimitError` y `Topology` existen una sola vez y el `instanceof` de `worker/netfix.ts` se conserva (§7.1 n.º 3). Un bundle por subpath duplicaría esas clases.
4. Classroom ya empaqueta con esbuild (Worker y panel). Dárselo empaquetado no ahorra nada.

Pendiente de comprobar (**NO VERIFICADO**): que `declaration: true` junto con `allowImportingTsExtensions` y `rewriteRelativeImportExtensions` (TS 5.9.3) genere `.d.ts` con especificadores que Classroom pueda resolver. Que el `.d.ts` de `ui` no exija `lib DOM` al Worker de Classroom (su `lib` es `WebWorker`). El tamaño del tarball.

Las fuentes (`src/`) pueden ir en el tarball para la oferta de código fuente de la GPL. El tag público del repositorio ya la cubre; incluirlas es opcional.

## 3. Licencia

**Comprobado en los ficheros:**
- El código de Netfix es GPL-3.0-or-later y la documentación CC BY-SA 4.0 (`LICENSE.md`).
- Classroom declara recibir Netfix con licencia privativa del titular (`LICENSE`, `NOTICE.md`, D1).
- El CLA es obligatorio para las aportaciones (`CONTRIBUTING.md`).
- Autores en la historia de `main`: dos nombres, `glopezca` (102 commits) y `Claude` (141). Hay 208 líneas `Co-Authored-By` de herramientas de IA. No aparece ningún tercero humano.

**Lo que implica la distribución:**
- Mandar el bundle de UI al navegador del alumnado es distribuir. Ejecutar `evaluate` en el Worker es uso en servidor, y la GPLv3 (que no es AGPL) no lo considera distribución.
- Sin la doble licencia, incluir el bundle en un producto privativo obligaría a ofrecer la obra combinada bajo GPL.
- La doble licencia solo vale si el titular tiene **todos** los derechos sobre lo que licencia.
- Publicar `@glopezca/netfix` como paquete GPL es compatible con la GPL. Que Classroom lo use con otra licencia no se ve en los metadatos del paquete: debe constar en `NOTICE.md` y `LICENSE` de Classroom (ya consta).
- Lo privativo (D12) no puede ir en el paquete público.

**Decisiones pendientes (no demostradas aquí):**

| # | Asunto |
|---|---|
| L1 | Revisión jurídica de D1, que la propia D1 deja pendiente |
| L2 | Titularidad y protección por derechos de autor del código escrito con asistencia de IA (141 commits con autor `Claude`). Afecta a lo que el titular puede licenciar de forma privativa |
| L3 | Si el espejo `infogerman/netfix` es del mismo titular, y cuál es el repositorio canónico en `repository`, `LICENSE.md` y `NOTICE.md` |
| L4 | Si el contenido de `src/docs/` y los textos de laboratorios dentro de `src/` son «código» (GPL) o «documentación» (CC BY-SA): `LICENSE.md` clasifica por carpeta. Ese contenido va dentro del bundle |
| L5 | Avisos que deben acompañar al paquete y al producto (fuentes OFL cargadas desde Google Fonts en `embed.html`, ECC MIT). Hoy no hay dependencias de ejecución de terceros (§1.1) |
| L6 | Autorización expresa para publicar (regla 11 del plan; Fase 3 «Licencia») |

## 4. Plan de CI

### 4.1 Netfix: publicación (`.github/workflows/release.yml`, nuevo en la Fase 3)

```yaml
on: { push: { tags: ['v*.*.*'] } }
permissions: { contents: read }          # por defecto, nada más
jobs:
  verify:   # sin permisos de escritura
    steps: checkout (SHA fijado), setup-node 22, npm ci,
           typecheck, test:coverage, build (standalone intacto),
           comprobar tag == "v" + package.json version,
           comprobar que el tag pertenece a main (como production de Classroom),
           npm pack --dry-run + lista blanca de ficheros,
           import de cada subpath en Node desde el tarball, prueba en workerd (§5.3)
  publish:
    needs: verify
    environment: package-release          # revisor obligatorio
    permissions: { contents: read, packages: write, id-token: write, attestations: write }
    steps: npm publish (NODE_AUTH_TOKEN = GITHUB_TOKEN), atestación del tarball
```

- Requisitos previos:
  - Un `package-lock.json` versionado: sin él, `npm ci` no funciona y la publicación no es reproducible.
  - Retomar los tags (hoy `v0.32.0` frente a `0.46.0`).
  - Fijar las acciones por SHA en los workflows nuevos.
- Antes de cada publicación real: ejecutar con `npm publish --dry-run`, o en un ámbito de prueba si el propietario lo autoriza (plan, Fase 3 tarea 9).
- Fuera de la Fase 3, pero conviene: añadir `permissions: contents: read` de nivel superior a `ci.yml`. Revisar `sync-infogerman.yml`: hace un `--force` con un token de otra cuenta y es independiente de la publicación (decisión L3).

### 4.2 Classroom: consumo (Fase 4)

- `.npmrc` versionado **sin token**: `@glopezca:registry=https://npm.pkg.github.com`. El token entra solo como variable de entorno.
- Jobs `check`, `staging` y `production`: `permissions: contents: read, packages: read`. `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Requiere conceder a `glopezca/FixITClassroom` acceso de lectura al paquete en sus ajustes. Que basta con `GITHUB_TOKEN` entre repositorios del mismo propietario personal está **NO VERIFICADO**.
- Fijado: versión exacta en `package.json` (`"@glopezca/netfix": "0.47.0"`, sin `^`) más `package-lock.json` con `integrity`. Así, navegador y Worker llevan la misma versión (`PUBLIC-API.md` §4.4).
- El paso «Versión de Netfix» pasa a ser `npm view @glopezca/netfix version` contra la versión fijada: sigue siendo un aviso que no hace fallar el CI.
- Sin PAT personal. Si la Fase 8 tiene que disparar eventos entre repositorios, hace falta una GitHub App de mínimo privilegio; solo el job que crea el PR tiene `contents: write` y `pull-requests: write` (plan §5).
- Desarrollo local: cada desarrollador necesita un token con `read:packages` en su `~/.npmrc`. Hay que documentarlo (Fase 3, tarea 10).

## 5. Plan de pruebas y corpus de regresión

### 5.1 Lo que existe

| Suite | Contenido | Dónde se ejecuta |
|---|---|---|
| Unitarias e integración (Netfix) | 186 `tests/**/*.test.ts` en 20 carpetas (`classroom/` con 5: `budget`, `embed`, `evaluate`, `evaluate-ext`, `restrictions`) | CI (`test:coverage`) |
| Compatibilidad (Netfix) | `tests/compat/dhcp-v01.test.ts` + `tests/fixtures/v0.1/*.json` (9 fixtures v1, `fdcf3d3`) | CI |
| Corpus de bash | `tests/bash/corpus/` (40 ficheros), regenerado con `scripts/gen-bash-corpus.sh` contra bash real | CI |
| E2E (Netfix) | 24 scripts `scripts/e2e*.mjs` con Playwright (instalación global o `PLAYWRIGHT_PATH`; Playwright no está en `devDependencies`), entre ellos `e2e-embed.mjs` y `e2e-missions.mjs` | **solo en local**, no en CI |
| Benchmark | `bench:evaluate` (CPU de la corrección por laboratorio) | manual |
| Classroom | `node --test` con cobertura 80/80; usa `EXAMPLES`, `parseRestrictions` y `parseChecklist` como fixtures; sin E2E (`CLASSROOM-CONSUMPTION.md` §5.4) | CI |

**NO VERIFICADO:** en esta auditoría no se ha ejecutado `npm test`, `typecheck`, `check` ni `e2e` de ningún repositorio (`build` escribe `demo/netfix-lab.html`, que está versionado). No se ha comprobado que pasen en `5c7b3e9` ni en `d443d98`.

### 5.2 Lo que falta para la compatibilidad (Fase 2)

1. Fixtures v0.31.0 (la forma de las entregas de producción), `format: 'netsim'`, y saltos de `featuresV` y de campos (v0.24, v0.34 `sambaOff`, v0.35, v0.37). Detalle en `PUBLIC-API.md` §4.3.
2. Round-trip estable de los laboratorios de `EXAMPLES` como test (hoy solo hay medición a mano, `PUBLIC-API.md` §5.2).
3. Determinismo de `evaluate`: dos ejecuciones con relojes distintos, incluido un laboratorio VPN/SSH (cierra B3 de `PUBLIC-API.md`).
4. Prueba de contrato de los exports: cada símbolo de `CLASSROOM-CONSUMPTION.md` §4–5 resuelve desde su subpath, y `WorkLimitError` es la misma clase en `topology` y `classroom`.
5. Muestra anonimizada de entregas reales de R2: **requiere autorización** (D4 de `PUBLIC-API.md`).

### 5.3 Lo que falta para el paquete y el runtime Worker (Fase 3)

| Prueba | Propuesta | Estado |
|---|---|---|
| Contenido del paquete | `npm pack --dry-run --json` contra una lista blanca (sin `tests/`, `.claude/`, `graphify-out/` ni `_site/`) | no existe |
| Importación en Node | proyecto temporal en el runner: instalar el `.tgz` e importar `./topology`, `./classroom` y `./ui` (este último solo comprobando el tipo, sin DOM) | no existe |
| Ejecución en workerd | `evaluate` sobre el corpus dentro de workerd. En Netfix exigiría una `devDependency` nueva (`wrangler`/`miniflare`), algo nuevo en un repositorio con cero dependencias: **decisión pendiente**. Alternativa: hacerla en Classroom, que ya tiene `wrangler` | no existe. Que `0.46.0` funcione en Workers: **NO VERIFICADO** (`DEPENDENCY-MAP.md` §4) |
| Tamaño y CPU | límite de tamaño del bundle del Worker y `bench:evaluate` en el runtime real | sin medir en workerd (`CLASSROOM-CONSUMPTION.md` §9) |
| Standalone intacto | `build` + `e2e` en CI, o al menos `e2e-embed` y `e2e-missions`, con Playwright fijado como `devDependency` | e2e fuera de CI |
| Tipos para el consumidor | `tsc` de Classroom (Worker con `lib WebWorker`) contra los `.d.ts` instalados | no existe |

## 6. Decisiones pendientes de este documento

| # | Decisión |
|---|---|
| P1 | Registro: GitHub Packages (recomendado), tarball en un Release o npm público |
| P2 | Repositorio canónico y espejo `infogerman` (`repository`, `LICENSE.md`, `sync-infogerman.yml`) |
| P3 | Versión del primer paquete y retomar los tags (`v0.32.0` frente a `0.46.0`); relación con `CLASSROOM-CONSUMPTION.md` §8.1 |
| P4 | Añadir `package-lock.json` a Netfix, y Playwright y workerd como `devDependencies` |
| P5 | Excepción escrita a la regla «sin reexportaciones» para los ficheros de entrada del paquete |
| L1–L6 | Licencia (§3): sin resolver, **no se publica** |
