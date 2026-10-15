# Netfix — guía para Claude Code

Netfix (antes netsim): simulador de redes en el navegador, clon funcional de Cisco Packet Tracer centrado en
la CLI de Cisco IOS y su servidor DHCP. TypeScript sin dependencias de ejecución.

Este proyecto sigue **Everything Claude Code (ECC)** v2.2.x. Las reglas están en
`.claude/rules/` (common + typescript, y `project/` con las reglas propias) y los agentes en `.claude/agents/`
(planner, tdd-guide, code-reviewer, typescript-reviewer, network-config-reviewer,
security-reviewer). Licencia de ECC en `.claude/ECC-LICENSE` (MIT).

## Flujo de trabajo (ECC)

1. **Planificar** con `planner` → el plan vive en `docs/PLAN.md`, por fases.
2. **TDD**: test primero en `tests/`, verlo fallar, implementar, refactorizar.
3. **Revisar** con `code-reviewer` / `typescript-reviewer`; la salida IOS se contrasta
   con `network-config-reviewer`.
4. **Commit** convencional (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`), una fase por bloque.
5. `npm run check` (typecheck + tests + build) debe pasar antes de cada commit.

## Modelos por fase

Detalle en `.claude/rules/project/model-selection.md`. Resumen: **opus** para planificar, implementar lo que cruza
módulos, seguridad y diseño visual; **sonnet** para tareas acotadas, revisión e IOS; **haiku** para búsquedas, textos y
resúmenes. Los agentes de `.claude/agents/` ya fijan su modelo (`planner` y `security-reviewer`: opus; el resto: sonnet).

## Comandos

```bash
npm test              # node:test con type-stripping nativo (Node >= 22.18)
npm run test:coverage # umbral 80 % líneas/funciones (núcleo, sin UI)
npm run typecheck     # tsc --noEmit sobre src/
npm run build         # dist/ (módulos) + dist/netfix.html (un solo archivo)
npm run serve         # servidor estático en http://localhost:8080
npm run e2e           # Playwright (si está instalado globalmente)
```

## Arquitectura

```
src/core/   ip.ts, mac.ts, clock.ts             utilidades puras (sin estado)
src/ios/    parser.ts (gramática + abreviaturas + ?), session.ts (modos), commands/*
src/dhcp/   pool.ts (config inmutable), server.ts (asignación, bindings), messages.ts
src/net/    network.ts (eventos discretos), packets.ts, ipstack.ts, tcp.ts, dns.ts, topology.ts (JSON v2)
src/devices/ router, switch, host.ts → pc.ts / server.ts (Server), cloud.ts (nube ISP), ios-web.ts
src/web/    páginas HTTP generadas con escape (html.ts): Roundcube, gestión web de Server y de IOS
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
- El empaquetador no admite reexportaciones (`export { x } from …`) ni imports solo por efecto: importa
  del módulo de origen. Para que `src/devices` no importe código de `src/web` se usan **registros**
  (`registerHostFs`, `registerWebApp`, `registerIosWeb`) que `registerWebApps()` rellena al cargar `net/topology.ts`.
- `src/ui/brand-data.ts` es generado desde `assets/brand/` (`npm run brand`, también en `npm run build`); las páginas web
  simuladas solo nombran clases `web-brand-*` y la imagen la pone el CSS de la app.
- `src/docs/about-data.ts` es generado (`npm run about`, también lo hace `npm run build`): tras cambiar la
  versión en `package.json` o `LICENSE.md`, regenéralo o falla `tests/docs/about.test.ts`.
- Internet emulada: `src/net/internet.ts` (núcleo y saltos), `internet-hosts.ts` (8.8.8.8, webs),
  `devices/cloud*.ts` (nube ISP, un plano IP por línea); NAT común en `src/net/nat.ts`.
