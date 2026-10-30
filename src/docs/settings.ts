/** Documentación: la pestaña Configuración (ajustes generales y del laboratorio actual), en estilo guiado. */
import type { DocPage } from './types.ts';
import { check, exercise, h, p, steps, table, tip } from './types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const SETTINGS_DOCS: readonly DocPage[] = [
  {
    id: 'configuracion',
    title: 'Configuración',
    summary: 'Idioma, tema y aviso de cambios sin guardar; y qué ajustes muestra cada tipo de equipo en el laboratorio abierto.',
    markdownBase: MD,
    blocks: [
      p('La pestaña **Configuración** (junto a Ayuda) tiene dos apartados. **Generales** vale para cualquier red y se guarda en este navegador. **Laboratorio actual** es de la red abierta: se guarda con ella al pulsar Guardar, y viaja en el archivo .netfix.json.'),
      h('Generales'),
      table(['Ajuste', 'Qué hace'], [
        ['Idioma', 'Español (España) o English (UK), como el desplegable de la barra superior.'],
        ['Tema', 'Automático (el del sistema), claro u oscuro.'],
        ['Avisar antes de reemplazar…', 'Si está desmarcado, Laboratorios, Nuevo y Abrir reemplazan la red sin preguntar aunque tenga cambios sin guardar.'],
        ['Prompt con marca de fecha y hora', 'Desactivado por defecto. Pone la fecha y la hora en el prompt de todas las terminales GNU/Linux y Windows (la misma casilla está al pie de cada terminal). En el aula, el profesor puede fijarlo.'],
      ]),
      h('Laboratorio actual'),
      p('Decide qué pestañas y paneles muestran las ventanas de cada tipo de equipo. **Equipo** (nombre de host) e **Interfaces** están siempre.'),
      table(['Equipo', 'Activado por defecto', 'Se puede activar'], [
        ['PC', 'TCP/IP, aplicaciones (navegador, correo, SSH, SFTP), terminal GNU/Linux y terminal Windows', '—'],
        ['Servidor', 'TCP/IP, cada servicio (SSH, DHCP, DNS, HTTP, correo, ficheros y registros), parámetros del kernel, firewall, terminal GNU/Linux y terminal Windows', '—'],
        ['Router GNU/Linux', 'Parámetros del kernel, firewall, VPN, cada servicio y terminal GNU/Linux', 'Terminal Windows'],
        ['Router y switch IOS', 'CLI y gestión web', '—'],
      ]),
      p('Los laboratorios grabados no limitan nada aquí: es la pestaña Configuración de cada equipo la que muestra solo lo que usa (abajo), así que un servicio que se marque o se instale con apt aparece siempre.'),
      h('La pestaña Configuración de cada equipo'),
      p('Cada PC, servidor y router GNU/Linux tiene además su propia pestaña **Configuración**: casillas para sus aplicaciones, servicios y terminales. Solo lista lo que el laboratorio permite (lo de arriba es el máximo), y al cambiar una casilla la ventana se reabre en esa pestaña con las pestañas nuevas.'),
      table(['Equipo', 'Activado por defecto', 'Desactivado por defecto'], [
        ['PC', 'TCP/IP, navegador, cliente SSH y el terminal de su sistema operativo', 'Correo, Archivos (SFTP) y el terminal del otro sistema'],
        ['Servidor', 'Colocado desde la paleta: configuración IP, ficheros, registros y el terminal GNU/Linux. Parámetros del kernel siempre (sin casilla)', 'Todos los servicios y el firewall: se marcan aquí o se instalan con apt (Instalar paquetes con apt)'],
        ['Router GNU/Linux', 'Colocado desde la paleta: ficheros, registros y el terminal GNU/Linux. Parámetros del kernel siempre', 'Servicios, firewall y VPN (casilla o apt)'],
      ]),
      p('En los laboratorios grabados, de cada pareja de PCs del mismo switch uno es Windows y el otro GNU/Linux; el correo solo está en los PCs con cuenta configurada y SFTP en PC1 de «SSH y SFTP con claves»; cada servidor muestra solo los servicios que arranca (más ficheros y registros).'),
      p('Los servidores de los laboratorios grabados y de los archivos guardados conservan los servicios que tenían.'),
      p('Al **colocar un PC** desde la paleta, Netfix pregunta si es GNU/Linux, Windows o ambos, y activa su terminal y la pila de red de ese sistema (TCP/IP → sistema operativo). Se puede cambiar después. Los servidores no preguntan: llevan GNU/Linux.'),
      p('La **gestión web** de servidores y routers GNU/Linux enseña en gris, sin formularios, las páginas de lo desactivado (en el equipo o en el laboratorio). Con la casilla **Ocultar en la gestión web… las opciones desactivadas** de Laboratorio actual ni siquiera aparecen en el menú.'),
      steps(
        ['Abre la pestaña', '**Configuración**, apartado **Laboratorio actual**.'],
        ['Marca o desmarca', 'Cada casilla cambia al momento. Las ventanas abiertas se cierran: al abrirlas de nuevo ya tienen las pestañas nuevas.'],
        ['Guarda', 'Es un cambio de la red: **Guardar** lo lleva al archivo, y cambiar de laboratorio sin guardar avisa.'],
      ),
      check('Compruébalo', 'Desmarca **Terminal Windows** en PC y abre un PC: ya no tiene esa pestaña. **Restablecer los valores predeterminados** la devuelve.'),
      tip('En el aula', 'Embebido en una práctica de Netfix Classroom, el apartado del laboratorio es de solo lectura, y las restricciones del profesor siguen mandando: una pestaña que él oculta no aparece aunque esté marcada aquí.'),
      exercise('Un servidor con cortafuegos', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», haz que el servidor muestre el panel Firewall y comprueba que no bloquea el acceso web.', 'En la ventana de SRV, pestaña **Configuración**, marca **Firewall** (o en su terminal `sudo apt install nftables`). Después, Servicios → Firewall aparece con su servicio parado. Desde PC0, el navegador sigue abriendo http://www.aula.lab mientras no actives nftables con reglas que lo impidan.'),
    ],
  },
];
