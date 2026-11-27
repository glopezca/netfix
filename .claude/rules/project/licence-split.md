# Netfix libre, funciones privativas fuera (Netfix)

Regla propia del proyecto (no forma parte de ECC). Decisión del titular (20/11/2026, reafirmada el 27/11/2026).

Netfix (GPL-3.0-or-later) solo recibe funciones **genéricas** o **puntos de extensión genéricos**. Lo que solo usa
FixIT Classroom (la LAN de clase, Codefix en Netfix, las comprobaciones de su corrección, las API de anfitrión de sus
consolas…) vive en el **paquete de extensión de Netfix Classroom** (`src/netfix-pack/` del repositorio privado), con su
licencia, y se conecta por esos puntos (`registerDeviceKind`, `setKindContext`, opciones de anfitrión, `reachesOutside`…).

## Antes de añadir algo a Netfix

1. ¿Lo usa la versión libre por sí misma? Si no, va al paquete; en Netfix, a lo sumo, un punto de extensión que no
   nombre ese producto (ni en código, ni en textos, ni en comentarios: «un tipo registrado», «la página anfitriona»).
2. Un arreglo que necesita una función privativa (p. ej. esperar respuestas de otra página) se resuelve en Netfix de forma
   genérica y la función privativa lo activa desde el paquete.
3. Si aparece en Netfix código o texto de una función privativa, se traslada al paquete en el mismo cambio.
