/** Documentación: los editores nano y vim de la Terminal Linux. */
import type { DocPage } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';

export const NANO_KEYS: readonly (readonly [string, string])[] = [
  ['Ctrl+O', 'Guardar (Write Out): confirma o cambia el nombre y pulsa Intro'],
  ['Ctrl+S', 'Guardar sin preguntar'],
  ['Ctrl+X', 'Salir; si hay cambios pregunta «Save modified buffer?» (Y / N / Ctrl+C)'],
  ['Ctrl+F (o Ctrl+W)', 'Buscar; Alt+W repite la búsqueda'],
  ['Ctrl+\\', 'Buscar y reemplazar: Y (este), N (siguiente), A (todos)'],
  ['Ctrl+K · Ctrl+U', 'Cortar la línea (varias seguidas se acumulan) · pegar'],
  ['Alt+U · Alt+E', 'Deshacer · rehacer'],
  ['Ctrl+_ (o Ctrl+/)', 'Ir a la línea (y columna)'],
  ['Ctrl+C', 'Posición del cursor; en un diálogo, cancelar'],
  ['Ctrl+G', 'Ayuda (Ctrl+X la cierra)'],
  ['Ctrl+A · Ctrl+E · Inicio · Fin', 'Principio y final de la línea'],
  ['Ctrl+Y · Ctrl+V · RePág · AvPág', 'Página anterior / siguiente'],
  ['Alt+\\ · Alt+/', 'Primera / última línea'],
];

export const VIM_KEYS: readonly (readonly [string, string])[] = [
  ['i a I A o O', 'Entrar en modo inserción (antes, después, inicio, final, línea nueva debajo / encima)'],
  ['Esc', 'Volver al modo normal'],
  ['h j k l · flechas', 'Mover el cursor (admiten número: 5j)'],
  ['w b e · 0 ^ $', 'Palabra siguiente / anterior / final · inicio, primer carácter, final de línea'],
  ['gg · G · NG · :N', 'Primera línea · última · línea N'],
  ['f{c} F{c} t{c} T{c}', 'Saltar a un carácter de la línea'],
  ['x X · r{c} · ~ · J', 'Borrar carácter · reemplazar · cambiar mayúsculas · unir líneas'],
  ['dd · D · dw · d$ · dG · 3dd', 'Borrar (las líneas o el movimiento)'],
  ['cc · C · cw · s · S', 'Cambiar (borra y entra en inserción)'],
  ['yy · Y · yw · p · P', 'Copiar · pegar después / antes'],
  ['u · Ctrl+R · .', 'Deshacer · rehacer · repetir el último cambio'],
  ['/texto · ?texto · n · N · *', 'Buscar adelante / atrás · siguiente / anterior · la palabra del cursor'],
  ['Ctrl+F · Ctrl+B · Ctrl+D · Ctrl+U · Ctrl+G', 'Avanzar / retroceder página o media página · información del fichero'],
  ['ZZ · ZQ', 'Guardar y salir · salir sin guardar'],
];

export const VIM_EX: readonly (readonly [string, string])[] = [
  [':w [fichero] · :w!', 'Guardar (con ! aunque sea de solo lectura)'],
  [':q · :q!', 'Salir · salir descartando los cambios'],
  [':wq · :x', 'Guardar y salir'],
  [':e!', 'Volver a la versión del disco'],
  [':N · :$', 'Ir a la línea N · a la última'],
  [':s/a/b/ · :s/a/b/g · :%s/a/b/g', 'Sustituir en la línea / en todo el fichero (& y \\1 en el reemplazo)'],
  [':d', 'Borrar la línea'],
  [':set nu · :set nonu', 'Mostrar u ocultar los números de línea'],
  [':set ro · :set noro', 'Solo lectura'],
];

export const EDITOR_DOCS: readonly DocPage[] = [
  {
    id: 'nano',
    title: 'nano',
    summary: 'GNU nano 8.4: teclas, diálogos y mensajes.',
    blocks: [
      code('nano fichero          # abre (o crea al guardar)\nnano +25 fichero      # en la línea 25\nsudo nano /etc/hosts  # ficheros de root\nnano -v fichero       # solo lectura'),
      p('La pantalla tiene la barra de título (versión, nombre y «Modified» si hay cambios), el texto, la línea de estado ([ Read 3 lines ], [ Wrote 3 lines ], [ New File ]…) y dos filas de atajos. ^ significa Ctrl y M- significa Alt.'),
      table(['Tecla', 'Acción'], NANO_KEYS),
      note('El navegador reserva Ctrl+W, Ctrl+N y Ctrl+T: para buscar usa Ctrl+F, que es el atajo propio de nano 8.'),
      p('Al guardar un fichero sin permiso nano muestra «[ Error writing /etc/hosts: Permission denied ]» y no cierra: sal con Ctrl+X → N y vuelve a abrirlo con sudo.'),
    ],
  },
  {
    id: 'vim',
    title: 'vim',
    summary: 'Vi IMproved 9.1: modos, órdenes de movimiento y edición, órdenes de dos puntos.',
    blocks: [
      code('vim fichero     vi fichero     view fichero (solo lectura)     vim +10 fichero'),
      p('vim tiene modos. Se abre en modo normal (las teclas son órdenes); i entra en modo inserción («-- INSERT --» abajo) y Esc vuelve. : abre la línea de órdenes. Abajo a la derecha está la posición (línea,columna) y All/Top/Bot o el porcentaje.'),
      h('Modo normal'),
      table(['Teclas', 'Acción'], VIM_KEYS),
      h('Órdenes de dos puntos'),
      table(['Orden', 'Acción'], VIM_EX),
      h('Mensajes habituales'),
      list(
        'E37: No write since last change (add ! to override) — :q con cambios sin guardar.',
        "E45: 'readonly' option is set (add ! to override) — fichero de solo lectura.",
        'W10: Warning: Changing a readonly file — empiezas a modificar uno de solo lectura.',
        '"f" E212: Can\'t open file for writing — sin permiso: :q! y sudo vim f.',
        'E486: Pattern not found: x · E492: Not an editor command: x · E32: No file name.',
      ),
      note('Los modos visual (v, V) y reemplazo (R) no están disponibles en Netfix.'),
    ],
  },
];
