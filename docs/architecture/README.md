# Migración Netfix → FixITClassroom — estado

Plan: `NETFIX-MIGRATION-ECC.md` (opción B; documento de coordinación fuera de este repositorio).

| Fase | Estado | Gate |
|------|--------|------|
| 0 — Auditoría y diseño | Entregables completos (2026-11-13) | GATE 0: pendiente de aprobación del propietario |
| 1–9 | No iniciadas | — |

Base auditada: Netfix `main` @ `5c7b3e9` (`0.46.0`), FixITClassroom `main` @ `d443d98`. `DEPENDENCY-MAP.md`, `PUBLIC-API.md` y
`CLASSROOM-CONSUMPTION.md` se auditaron en `496a092` y se revalidaron en `5c7b3e9` (solo cambió el trabajo de nombres de equipo).

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
2. No empezar la Fase 1 sin aprobación explícita de GATE 0.
3. No escribir artefactos de la migración en `/tmp`.
