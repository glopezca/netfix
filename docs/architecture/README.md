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
| 6 — Frontend nativo sin iframe | Completada (Netfix PR #45–#48, `0.49.0`–`0.49.2`; Classroom PR #17, #18, #22–#24): `netfixMount()` nativo, `embed.html` retirado, CSS bajo `.netfix-root` (C5), la página dimensiona el montaje; el laboratorio libre sigue en su propia página (C4). Restricciones aplicadas en el servidor (`worker/netfix.ts`); sin acceso del navegador a D1/R2 ni secretos; bundle sin red ni `eval`. E2E de profesor y alumno bajo la CSP de producción (4/4). Revisión de seguridad: hallazgo 1 (MEDIO, carga sin límite en la revisión del profesor) corregido en #22; **el resto del informe no quedó guardado** | GATE 6: **pendiente** del propietario |
| 7 — Versionado de datos | Completada (Classroom PR #19): versión de motor y SHA-256 por resultado (migración 0014), evaluación histórica (D19), recuperación y retención documentadas; topologías antiguas importables (prueba heredada) | GATE 7: **pendiente** del propietario |
| 8 — Netfix Sync | Completada (Classroom PR #21): `netfix-sync.yml` semanal + manual, abre PR sin merge ni despliegue; ejecución manual 2026-11-16: "Netfix 0.49.2 al día" | GATE 8: **pendiente**; aún no ha abierto un PR real (lo hará con la próxima versión) |
| 9 — Retirada del submódulo | Completada (Classroom PR #20, #12): sin `.gitmodules` ni `vendor/netfix` funcional (solo menciones históricas en `PLAN.md`), sin source maps públicos, `.assetsignore`. Classroom `main` `73aaa9c`: check 297/297, CI verde, staging desplegado con `0.49.2` (`/api/health` ok). Netfix `main` `9f35708`: CI verde | GATE 9: **pendiente**; producción sigue desactivada (`DEPLOY_PRODUCTION=false`) |

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
