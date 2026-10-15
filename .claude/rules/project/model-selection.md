# Selección de modelo (Netfix)

Regla propia del proyecto (no forma parte de ECC). Criterio: efectividad primero, después consumo de tokens.
Los agentes de `.claude/agents/` ya llevan su modelo en la cabecera (`model:`); esta tabla dice qué usar en cada fase.

| Fase ECC | Modelo | Motivo |
|---|---|---|
| Planificar (`planner`), arquitectura | **opus** | Un mal plan sale caro: reglas de imports, tamaños, registros. |
| Implementar una función que cruza módulos (red + UI + shells, persistencia, permisos) | **opus** (sesión principal) | Los casos límite aparecen al razonar sobre el conjunto. |
| Implementar algo acotado a un módulo con pruebas claras (`tdd-guide`) | **sonnet** | Suficiente y más barato. |
| Textos, traducciones es/en, documentación, versión, PLAN.md, credenciales | **sonnet** o **haiku** | Ediciones localizadas que validan las pruebas (paridad, about-data). |
| Revisión general (`code-reviewer`, `typescript-reviewer`) | **sonnet**; **opus** si el cambio es grande o delicado | Encuentra fallos reales a menor coste. |
| Seguridad (`security-reviewer`): permisos del VFS, HTML con datos del usuario, importación de archivos, SSH | **opus** | Un fallo aquí cuesta más que los tokens. |
| Salida IOS (`network-config-reviewer`) | **sonnet** | Contraste de formato con IOS 15, bien definido. |
| Búsquedas en el código (Explore) y resúmenes de pruebas o e2e | **haiku** | Lectura en volumen, sin decisiones de diseño. |
| Diseño visual (página de presentación, capturas) | **opus** | Juzgar el resultado y criticarlo con capturas. |

## Para gastar menos

1. Subagentes solo cuando aportan una mirada independiente (revisión): cada uno empieza sin contexto y relee archivos.
2. Peticiones concretas (qué, dónde, con qué mensajes) en vez de abiertas.
3. Una sesión por versión o funcionalidad: las sesiones muy largas se compactan y obligan a releer.
4. Dejar que `npm run check`, el e2e y las comprobaciones de tamaño y ciclos detecten lo mecánico.
