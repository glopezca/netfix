# Contribuir a Netfix

Gracias por el interés. Antes de proponer código o documentación, ten en cuenta cómo se licencia Netfix.

## Doble licencia

Netfix es software libre: el código se publica bajo **GPL-3.0-or-later** y la documentación bajo **CC BY-SA 4.0**
(ver [LICENSE.md](LICENSE.md)). Además, su autor licencia el mismo código con otros términos en productos propios
(por ejemplo, Netfix Classroom). Para que eso siga siendo posible, todo el contenido del repositorio debe poder
licenciarse por su titular.

## Cesión de derechos (CLA)

Por eso **solo se aceptan aportaciones con un acuerdo de cesión de derechos** (CLA) firmado: quien aporta conserva el
reconocimiento de su autoría y concede al titular de Netfix (Germán López Castro) una licencia perpetua, mundial,
gratuita e irrevocable para usar, modificar, sublicenciar y distribuir la aportación bajo cualquier licencia, incluida
la GPL. Sin ese acuerdo, un *pull request* no puede integrarse.

Si quieres aportar, abre primero una *issue* describiendo el cambio; se te indicará cómo firmar el CLA.

Lo que no requiere CLA: informar de errores, proponer mejoras en *issues* o publicar tu propia versión modificada de
Netfix bajo la GPL, como permite su licencia.

## Cómo se trabaja

El proyecto sigue el flujo ECC descrito en [CLAUDE.md](CLAUDE.md): plan en `docs/PLAN.md`, pruebas primero, revisión y
`npm run check` antes de cada commit, con mensajes convencionales (`feat:`, `fix:`, `docs:`…).
