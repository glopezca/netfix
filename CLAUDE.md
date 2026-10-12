# netsim — guía para Claude Code

Simulador de redes en el navegador, clon funcional de Cisco Packet Tracer centrado en
la CLI de Cisco IOS y su servidor DHCP. TypeScript sin dependencias de ejecución.

Este proyecto sigue **Everything Claude Code (ECC)** v2.2.x. Las reglas están en
`.claude/rules/` (common + typescript) y los agentes en `.claude/agents/`
(planner, tdd-guide, code-reviewer, typescript-reviewer, network-config-reviewer,
security-reviewer). Licencia de ECC en `.claude/ECC-LICENSE` (MIT).

## Flujo de trabajo (ECC)

1. **Planificar** con `planner` → el plan vive en `docs/PLAN.md`, por fases.
2. **TDD**: test primero en `tests/`, verlo fallar, implementar, refactorizar.
3. **Revisar** con `code-reviewer` / `typescript-reviewer`; la salida IOS se contrasta
   con `network-config-reviewer`.
4. **Commit** convencional (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`), una fase por bloque.
5. `npm run check` (typecheck + tests + build) debe pasar antes de cada commit.

## Comandos

```bash
npm test              # node:test con type-stripping nativo (Node >= 22.18)
npm run test:coverage # umbral 80 % líneas/funciones (núcleo, sin UI)
npm run typecheck     # tsc --noEmit sobre src/
npm run build         # dist/ (módulos) + dist/netsim.html (un solo archivo)
npm run serve         # servidor estático en http://localhost:8080
npm run e2e           # Playwright (si está instalado globalmente)
```

## Arquitectura

```
src/core/   ip.ts, mac.ts, clock.ts             utilidades puras (sin estado)
src/ios/    parser.ts (gramática + abreviaturas + ?), session.ts (modos), commands/*
src/dhcp/   pool.ts (config inmutable), server.ts (asignación, bindings), messages.ts
src/net/    network.ts (eventos discretos), packets.ts, ipstack.ts, tcp.ts, dns.ts, topology.ts (JSON v2)
src/devices/ router, switch, host.ts → pc.ts / server.ts (Server-PT)
src/services/ dhcp-pt, dns-service, http-service, mail-service, ssh-service, units, persist
src/bash/   intérprete bash 5.3 (lexer, parser, expand, exec con generadores, vfs, builtins/, coreutils/)
src/editors/ nano.ts, vim*.ts (motores puros; la UI dibuja Frame)
src/docs/   documentación estructurada (pestaña Documentación, man, help)
src/shells/ base.ts (cliente SSH), linux.ts (adaptador de BashSession), host-system.ts (VFS por equipo), windows.ts, factory.ts
src/ui/     interfaz tipo Packet Tracer (SVG + DOM, sin frameworks)
tests/      *.test.ts  (unit + integración DORA/relay) ; e2e/ (Playwright)
```

## Convenciones

- Solo sintaxis TypeScript *borrable* (`erasableSyntaxOnly`): nada de `enum`,
  `namespace` ni propiedades de parámetro. Imports relativos con extensión `.ts`.
- Configuración (pools, interfaces) = registros inmutables que se reemplazan
  (`{...pool, lease}`); el motor de simulación es el único estado mutable y está
  encapsulado en `Network` / dispositivos.
- La salida de la CLI imita IOS 15 / Packet Tracer **literalmente** (mensajes `%`,
  marcador `^`, formato de `show`). La UI está en español.
- Archivos < 400 líneas, funciones < 50 líneas, sin `any`, sin `console.log`.
- Nunca insertar HTML con datos del usuario sin escapar (`textContent` o `escapeHtml`).
- El build empaqueta un script clásico: **prohibidos los ciclos de imports de valor** (los `import type` sí).
  En `src/bash`, solo `interp.ts`/`source.ts` importan `exec.ts`; el resto llama a métodos de `Interp`.
- La salida de bash se contrasta con el bash real: añade casos a `tests/bash/corpus/` y regenera con
  `scripts/gen-bash-corpus.sh` (los `*.manual.sh` son de bash 5.3 y se escriben a mano).
- Toda orden nueva de la terminal necesita su entrada en `src/docs/utils.ts` (lo comprueba un test).
