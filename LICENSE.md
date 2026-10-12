# Licencia y atribuciones

- **Autoría:** Germán López Castro
- **Repositorio:** <https://github.com/glopezca/netfix>

Netfix usa dos licencias según el tipo de material, las dos con la misma idea de
«compartir igual»: quien distribuya versiones modificadas debe publicarlas con la misma licencia.

| Material | Licencia |
|---|---|
| Código fuente: `src/`, `tests/`, `scripts/`, configuración del proyecto y los archivos que genera el build | [GNU GPL v3.0 o posterior](https://www.gnu.org/licenses/gpl-3.0.html) (`GPL-3.0-or-later`) — texto completo en [`LICENSE`](LICENSE) |
| Documentación e imágenes: `README.md`, `docs/`, capturas y textos de los laboratorios | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es) — [texto legal](https://creativecommons.org/licenses/by-sa/4.0/legalcode.es) |
| `.claude/` (reglas y agentes de Everything Claude Code) | MIT, de sus autores (ver más abajo) |

La GPL es una licencia pensada para software: exige entregar el código fuente junto con
cualquier versión distribuida (también la página HTML compilada) y protege el derecho de
uso, estudio, modificación y redistribución. Creative Commons recomienda no usar sus licencias
para código, por eso CC BY-SA 4.0 queda solo para la documentación. Las dos licencias son
compatibles en un sentido: el material CC BY-SA 4.0 puede incorporarse a obras GPLv3.

## Aviso de copyright del código

```
Netfix — simulador de redes con CLI de Cisco IOS y servidor DHCP
Copyright (C) 2026 Germán López Castro

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```

## Atribución recomendada

Para la documentación o las capturas:

> «Netfix», de Germán López Castro (<https://github.com/glopezca/netfix>),
> distribuido bajo licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es).

Para el software o una obra derivada:

> Basado en «Netfix», de Germán López Castro (<https://github.com/glopezca/netfix>),
> GPL-3.0-or-later. Cambios: …

## Componentes de terceros

### Everything Claude Code (ECC)

Las reglas y los agentes de la carpeta `.claude/` (`.claude/rules/`, `.claude/agents/`,
`.claude/commands/`) proceden de
[Everything Claude Code](https://github.com/affaan-m/everything-claude-code)
y se mantienen bajo su licencia original **MIT**, © 2026 Affaan Mustafa.
El texto completo está en [`.claude/ECC-LICENSE`](.claude/ECC-LICENSE).
La licencia MIT es compatible con la GPLv3; la GPL y la CC BY-SA de este repositorio no se
aplican a esos archivos.

### Marcas

Cisco, Cisco IOS y Packet Tracer son marcas de Cisco Systems, Inc. Netfix es un proyecto
educativo independiente, sin relación con Cisco ni respaldado por ella. Los símbolos de red
de la interfaz son dibujos propios de este proyecto.
