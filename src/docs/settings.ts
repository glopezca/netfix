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
        ['Prompt con marca de fecha y hora', 'Desactivado por defecto. Pone la fecha y la hora en el prompt de todas las terminales Linux y Windows (la misma casilla está al pie de cada terminal). En el aula, el profesor puede fijarlo.'],
      ]),
      h('Laboratorio actual'),
      p('Decide qué pestañas y paneles muestran las ventanas de cada tipo de equipo. **Equipo** (nombre de host) e **Interfaces** están siempre.'),
      table(['Equipo', 'Activado por defecto', 'Se puede activar'], [
        ['PC', 'Configuración IP, aplicaciones (navegador, correo, SSH, SFTP), terminal Linux y terminal Windows', '—'],
        ['Servidor', 'Configuración IP, cada servicio (SSH, DHCP, DNS, HTTP, correo, ficheros y registros), terminal Linux y terminal Windows', 'Parámetros del kernel y firewall (en Servicios)'],
        ['Router Linux', 'Parámetros del kernel, firewall, VPN, cada servicio y terminal Linux', 'Terminal Windows'],
        ['Router y switch IOS', 'CLI y gestión web', '—'],
      ]),
      p('Esos son los valores de una red nueva (**Nuevo**). Cada laboratorio grabado trae los suyos: sus servidores muestran solo los servicios que usa (por ejemplo, «DNS de empresa que reenvía a Internet» solo DHCP y DNS), y en «Bastionado: ACL, nftables y sshd» el servidor tiene además parámetros del kernel y firewall. Un laboratorio sin servidores deja los valores por defecto.'),
      steps(
        ['Abre la pestaña', '**Configuración**, apartado **Laboratorio actual**.'],
        ['Marca o desmarca', 'Cada casilla cambia al momento. Las ventanas abiertas se cierran: al abrirlas de nuevo ya tienen las pestañas nuevas.'],
        ['Guarda', 'Es un cambio de la red: **Guardar** lo lleva al archivo, y cambiar de laboratorio sin guardar avisa.'],
      ),
      check('Compruébalo', 'Desmarca **Terminal Windows** en PC y abre un PC: ya no tiene esa pestaña. **Restablecer los valores predeterminados** la devuelve.'),
      tip('En el aula', 'Embebido en una práctica de Netfix Classroom, el apartado del laboratorio es de solo lectura, y las restricciones del profesor siguen mandando: una pestaña que él oculta no aparece aunque esté marcada aquí.'),
      exercise('Un servidor con cortafuegos', 'En el laboratorio «Server: DHCP, DNS, web, correo y SSH», haz que el servidor muestre el panel Firewall y comprueba que no bloquea el acceso web.', 'Configuración → Laboratorio actual → Servidor: marca **Firewall**. En la ventana de SRV, Servicios → Firewall aparece con su servicio parado. Desde PC0, el navegador sigue abriendo http://www.aula.lab mientras no actives nftables con reglas que lo impidan.'),
    ],
  },
];
