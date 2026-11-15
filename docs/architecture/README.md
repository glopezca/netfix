# Migración Netfix → FixITClassroom — estado

Plan: `NETFIX-MIGRATION-ECC.md` (opción B; documento de coordinación fuera de este repositorio).

| Fase | Estado | Gate |
|------|--------|------|
| 0 — Auditoría y diseño | Entregables completos (2026-11-13), revalidados en `6e7c887` (2026-11-14) | GATE 0: **aprobado** por el propietario (2026-11-14) |
| 1 — Core | Completada (PR #23–#32); 1.8 (definir/arrancar `ui/main.ts`, R7) hecho al empezar la Fase 6 | GATE 1: **aprobado** por el propietario (2026-11-15) |
| 2 — Contratos y esquema | Completada (PR #34–#37); contratos en `PUBLIC-API.md` §3 | GATE 2: **aprobado** por el propietario (2026-11-15) |
| 3 — Paquete | Completada (PR #38–#44); `@glopezca/netfix` publicado en GitHub Packages (`0.47.2`, `0.48.0` con `./authoring`) | GATE 3: **aprobado** por el propietario (2026-11-15) |
| 4 — Classroom consume el paquete | Completada (Classroom PR #12, `0.48.0` fijado; staging desplegado) | GATE 4: **aprobado** por el propietario (2026-11-15) |
| 5 — Core en el Worker | Completada (Classroom PR #13–#16): versión del motor por resultado, hash de la entrega, autorización negativa, límites medidos en workerd (`DESPLIEGUE.md`), reentregas de cola | GATE 5: **aprobado** por el propietario (2026-11-15) |
| 6 — Frontend nativo sin iframe | En curso: 1.8 (`ui/boot.ts` arranca; `ui/main.ts` solo define) | — |
| 7–9 | No iniciadas | — |

Base auditada: Netfix `main` @ `5c7b3e9` (`0.46.0`), FixITClassroom `main` @ `d443d98`. `DEPENDENCY-MAP.md`, `PUBLIC-API.md` y
`CLASSROOM-CONSUMPTION.md` se auditaron en `496a092` y se revalidaron en `5c7b3e9` (solo cambió el trabajo de nombres de equipo).

> **Revalidación en `6e7c887` (`0.47.0`, merge PR #20, 2026-11-14):** `5c7b3e9..6e7c887` es el disco de Windows en `/mnt/c` (26 ficheros de `src`, +195/−74). No toca ningún fichero que consuma Classroom (`classroom/`, `net/topology*.ts`, `core/clock.ts`, `net/examples.ts`, `ui/main.ts`). Entra en el cierre de `evaluate.ts` por `shells/host-system.ts` el fichero nuevo `shells/win-system.ts` (solo VFS: `devices/kinds.ts`, `bash/{vfs,types,path}.ts`, `shells/{win-path,hosts-file}.ts`; sin APIs de navegador). Los registros de `host-system.ts` pasan a `:355,359`. `src/**/*.ts`: 622 ficheros. `npm run check` (typecheck, 1167 pruebas, build) pasa en `6e7c887`; `e2e` y `workerd` siguen **NO VERIFICADO**.


## Entregables de la Fase 0

| Documento | Contenido |
|-----------|-----------|
| [CORE.md](CORE.md) | Clasificación de módulos y frontera propuesta del Core |
| [DEPENDENCY-MAP.md](DEPENDENCY-MAP.md) | Mapa de dependencias, APIs de navegador, matriz navegador/Worker, matriz de responsabilidades |
| [PUBLIC-API.md](PUBLIC-API.md) | Flujos de topología, API pública inicial, compatibilidad y reproducibilidad |
| [CLASSROOM-CONSUMPTION.md](CLASSROOM-CONSUMPTION.md) | Cómo Classroom consume Netfix, inventario del submódulo, persistencia |
| [PACKAGING.md](PACKAGING.md) | Estado inicial, empaquetado, licencia, CI, plan de pruebas |
| [RISKS.md](RISKS.md) | Registro de riesgos, decisiones pendientes, desglose en PR de las fases 1–9 |

## Para la siguiente sesión

1. Leer este fichero y `RISKS.md` §2 (decisiones pendientes) y §3 (desglose en PR).
2. GATE 0 aprobado el 2026-11-14; la Fase 1 sigue el desglose de `RISKS.md` §3 y no pasa de GATE 1 sin aprobación.
3. No escribir artefactos de la migración en `/tmp`.
