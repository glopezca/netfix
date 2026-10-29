/** Documentación: referencia de bash (variables, prompt, opciones, arranque, historial, trabajos, novedades 5.3 y órdenes internas). */
import type { DocBlock, DocPage } from './types.ts';
import { code, exercise, h, list, note, p, steps, table, term, tip, warn } from './types.ts';
import { BUILTIN_DOCS } from './bash-builtins.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

function builtinBlocks(): DocBlock[] {
  const names = Object.keys(BUILTIN_DOCS).sort((a, b) => a.localeCompare(b));
  const blocks: DocBlock[] = [
    p('Las órdenes internas se ejecutan dentro del shell. help muestra la ayuda de cada una (help -s: solo la sinopsis; help -d: la descripción corta); type dice si un nombre es una palabra reservada, un alias, una función, una orden interna o un programa.'),
    table(['Orden', 'Sinopsis', 'Descripción'], names.map((n) => [n, BUILTIN_DOCS[n]?.synopsis ?? '', BUILTIN_DOCS[n]?.summary ?? ''])),
  ];
  for (const n of names) {
    const d = BUILTIN_DOCS[n];
    if (d?.detail) blocks.push(h(n), code(d.detail));
  }
  return blocks;
}

export const BASH_REFERENCE: readonly DocPage[] = [
  {
    id: 'bash-variables',
    title: 'bash: variables especiales y prompt',
    summary: 'Parámetros especiales, variables del shell y secuencias de PS1.',
    markdownBase: MD,
    blocks: [
      p('bash guarda información en **variables especiales**: el estado de la última orden (`$?`), los argumentos (`$1`, `$#`…), la versión, el directorio… Una de ellas, **PS1**, es el texto del **prompt**: cambiarla es la forma más rápida de ver cómo funcionan.'),
      steps(
        ['Mira el estado', '`false; echo $?` da 1; en una tubería, `${PIPESTATUS[@]}` guarda el de cada orden.'],
        ['Prueba un prompt', "`PS1='\\u en \\W\\$ '`: el cambio es inmediato, pero solo dura esta sesión."],
        ['Hazlo permanente', 'Añádelo al final de `~/.bashrc` y recárgalo con `source ~/.bashrc`.'],
      ),
      term('shell', "alumno@pc1:~$ false | true; echo \"${PIPESTATUS[@]}\"\n1 0\nalumno@pc1:~$ echo $BASH_VERSION\n5.3.20(1)-release\nalumno@pc1:~$ PS1='\\u en \\W\\$ '\nalumno en ~$ cd /etc\nalumno en etc$ cd"),
      table(['Variable', 'Contenido'], [
        ['$? · $$ · $! · $- · $_', 'Estado de la última orden · PID del shell · PID del último trabajo en segundo plano · opciones activas · último argumento'],
        ['BASH_VERSION · BASH_VERSINFO', '5.3.20(1)-release · (5 3 20 1 release x86_64-pc-linux-gnu)'],
        ['BASHPID · PPID · UID · EUID · GROUPS', 'Identificadores del proceso y del usuario'],
        ['HOME · USER · LOGNAME · SHELL · PATH · PWD · OLDPWD', 'Entorno de la sesión'],
        ['HOSTNAME · HOSTTYPE · OSTYPE · MACHTYPE', 'Datos de la máquina'],
        ['RANDOM · SRANDOM · SECONDS · EPOCHSECONDS · EPOCHREALTIME · BASH_MONOSECONDS', 'Números aleatorios y tiempo'],
        ['LINENO · FUNCNAME · BASH_SOURCE · BASH_LINENO · BASH_COMMAND', 'Depuración'],
        ['PIPESTATUS · BASH_REMATCH · REPLY · OPTARG · OPTIND', 'Resultados de tuberías, [[ =~ ]], read y getopts'],
        ['IFS · PS1 · PS2 · PS4 · PROMPT_COMMAND', 'Separadores y prompts'],
        ['HISTFILE · HISTSIZE · HISTFILESIZE · HISTCONTROL · HISTTIMEFORMAT', 'Historial'],
        ['SHLVL · BASH_SUBSHELL · COLUMNS · LINES · TERM · LANG', 'Anidamiento y terminal'],
        ['GLOBSORT · FUNCNEST · CDPATH', 'Comportamiento'],
      ]),
      h('Secuencias del prompt (PS1)'),
      table(['Secuencia', 'Se sustituye por'], [
        ['\\u · \\h · \\H', 'usuario · nombre corto del equipo · nombre completo'],
        ['\\w · \\W', 'directorio actual (~ para $HOME) · solo su último componente'],
        ['\\$', '# para root, $ para el resto'],
        ['\\d · \\t · \\T · \\@ · \\A · \\D{fmt}', 'fecha y horas (strftime)'],
        ['\\s · \\v · \\V · \\# · \\! · \\j', 'shell, versión, nº de orden, nº de historial, trabajos'],
        ['\\n · \\e · \\[ … \\]', 'salto de línea, ESC, delimitan secuencias de color'],
      ]),
      code("PS1='\\[\\e[01;32m\\]\\u@\\h\\[\\e[00m\\]:\\[\\e[01;34m\\]\\w\\[\\e[00m\\]\\$ '   # el de Ubuntu"),
      tip('Copia de seguridad', 'Antes de tocar `~/.bashrc`, `cp ~/.bashrc ~/.bashrc.bak`: si el prompt queda roto, `cp ~/.bashrc.bak ~/.bashrc` y abre otra terminal.'),
      exercise('Tu prompt', 'En la Terminal GNU/Linux de PC1, haz que el prompt muestre usuario@equipo y la ruta completa, y que se conserve en las siguientes sesiones.', "`echo 'PS1=\"\\u@\\h:\\w\\$ \"' >> ~/.bashrc` y `source ~/.bashrc`. Tras `cd /var/log` el prompt es «alumno@pc1:/var/log$». \\w es la ruta completa (con ~ para tu home) y \\W solo su último componente."),
    ],
  },
  {
    id: 'bash-opciones',
    title: 'bash: opciones y ficheros de arranque',
    summary: 'set -euxo pipefail, shopt y qué ficheros lee bash al empezar.',
    markdownBase: MD,
    blocks: [
      p('Las **opciones** cambian cómo se comporta bash. Las de `set` son las que más importan en un script: que pare al primer error, que avise de variables sin definir y que enseñe lo que ejecuta. Las de `shopt` afinan los comodines y el historial.'),
      steps(
        ['Para al primer error', '`set -e`: si una orden falla, el script termina con su estado.'],
        ['Nada de variables fantasma', '`set -u`: usar una variable sin definir es un error, no una cadena vacía.'],
        ['Tuberías honestas', '`set -o pipefail`: una tubería falla si falla cualquiera de sus órdenes, no solo la última.'],
        ['Mira qué pasa', '`set -x` enseña cada orden expandida (o `bash -x script.sh`).'],
      ),
      term('shell', 'alumno@pc1:~$ printf "set -e\\nfalse\\necho nunca\\n" > e.sh; bash e.sh; echo "estado: $?"\nestado: 1\nalumno@pc1:~$ printf "set -o pipefail\\nfalse | true\\necho \\$?\\n" > p.sh; bash p.sh\n1\nalumno@pc1:~$ set -x; echo hola; set +x\n+ echo hola\nhola\n+ set +x'),
      table(['set', 'Efecto'], [
        ['-e (errexit)', 'Termina el script si una orden falla (salvo en condiciones, && y ||).'],
        ['-u (nounset)', 'Error al usar una variable sin definir.'],
        ['-x (xtrace)', 'Muestra cada orden expandida con PS4 (+) antes de ejecutarla.'],
        ['-o pipefail', 'Una tubería falla si falla cualquiera de sus órdenes.'],
        ['-f (noglob) · -C (noclobber) · -n (noexec) · -v (verbose) · -a (allexport)', 'Comodines, sobrescritura, solo analizar, eco de la entrada, exportar todo'],
        ['-H (histexpand) · -m (monitor) · -b · -h · -k · -P · -T · -E', 'Historial con !, control de trabajos y otras (se aceptan)'],
      ]),
      h('shopt'),
      table(['Opción', 'Efecto'], [
        ['extglob · globstar · dotglob · nullglob · failglob · nocaseglob · globasciiranges', 'Comodines'],
        ['nocasematch', 'case y [[ == ]] sin distinguir mayúsculas'],
        ['expand_aliases', 'Expande alias (activa en shells interactivos)'],
        ['lastpipe', 'La última orden de una tubería se ejecuta en el shell actual'],
        ['patsub_replacement', '& en ${v/pat/rep} es lo encontrado (activa por defecto)'],
        ['cmdhist · lithist · histappend', 'Cómo se guardan las órdenes de varias líneas'],
        ['login_shell (solo lectura) · checkwinsize · sourcepath · xpg_echo · localvar_inherit', 'Varias'],
      ]),
      h('Ficheros de arranque'),
      list(
        'Shell de inicio de sesión (SSH, sudo -i, su -, bash -l): /etc/profile y luego ~/.profile, que carga ~/.bashrc. Al salir, ~/.bash_logout.',
        'Shell interactivo normal (la Terminal GNU/Linux, bash): /etc/bash.bashrc y ~/.bashrc.',
        'Scripts (bash script.sh, ./script.sh con #!): no leen ningún fichero.',
        '~/.bashrc de Ubuntu: prompt en color, HISTCONTROL=ignoreboth, alias ls/grep con color, ll, la y l.',
        'command_not_found_handle (en /etc/bash.bashrc) sugiere el paquete: «Command \'ifconfig\' not found, but can be installed with: sudo apt install net-tools».',
      ),
      warn('Cuidado con set -e', 'No salta dentro de condiciones (`if orden`, `orden || …`, `&&`): ahí un fallo es una respuesta, no un error. Y en la terminal interactiva, `set -e` cierra la sesión al primer fallo: úsalo en scripts.'),
      exercise('Un script que no sigue a ciegas', 'En PC1, escribe un script que haga `cd /noexiste` y después `rm -f *.tmp`. ¿Qué pasa sin opciones y qué con `set -e` al principio?', 'Sin opciones, `cd` falla («No such file or directory») y `rm` se ejecuta igualmente en el directorio actual: justo lo que no querías. Con `set -e` en la primera línea, el script termina en el `cd` con estado 1 y `rm` no llega a ejecutarse.'),
    ],
  },
  {
    id: 'bash-interactivo',
    title: 'bash: teclado, historial y trabajos',
    summary: 'Teclas de la terminal, expansión del historial (!), alias y control de trabajos.',
    markdownBase: MD,
    blocks: [
      p('En la terminal, bash ayuda a escribir menos: **Tab** completa, las flechas recorren el **historial** y `!` repite órdenes anteriores. También puede lanzar órdenes en **segundo plano** con `&`.'),
      steps(
        ['Completa', 'Escribe el principio de una orden o de un fichero y pulsa **Tab** (dos veces si hay varias opciones).'],
        ['Repite', '`!!` repite la última orden; `!$` es su último argumento.'],
        ['Corrige', '`^viejo^nuevo` repite la última cambiando un texto: ideal para una errata.'],
        ['En segundo plano', '`orden &` devuelve el prompt al momento; `jobs` lista lo que está en marcha.'],
      ),
      term('shell', 'alumno@pc1:~$ echo uno\nuno\nalumno@pc1:~$ !!\necho uno\nuno\nalumno@pc1:~$ ^uno^dos\necho dos\ndos'),
      table(['Tecla', 'Acción'], [
        ['Tab · Tab Tab', 'Completa órdenes, ficheros y $variables · lista las opciones'],
        ['↑ ↓', 'Historial de la terminal'],
        ['Ctrl+C', 'Interrumpe la orden (estado 130) o descarta la línea'],
        ['Ctrl+D', 'Fin de la entrada (read, cat); con la línea vacía, sale del shell («exit» / «logout»)'],
        ['Ctrl+L', 'Limpia la pantalla (como clear)'],
      ]),
      h('Expansión del historial'),
      table(['Forma', 'Se sustituye por'], [
        ['!! · !n · !-n', 'la última orden · la orden n · la n-ésima anterior'],
        ['!texto · !?texto?', 'la última que empieza por / contiene texto'],
        ['!$ · !^ · !* · !:n', 'último argumento · primero · todos · el n'],
        ['^viejo^nuevo', 'repite la última cambiando viejo por nuevo'],
        [':p · :s/a/b/ · :h · :t · :r · :e', 'solo mostrar · sustituir · modificadores de ruta'],
      ]),
      p('history muestra el historial (HISTTIMEFORMAT añade la fecha); fc -l lo lista y fc -s repite. El historial se guarda en ~/.bash_history al salir.'),
      h('Trabajos'),
      p('orden & arranca un trabajo en segundo plano. En Netfix no hay procesos reales: el trabajo termina al momento y bash avisa con [1]+ Done antes del siguiente prompt. jobs, wait, fg, bg, disown y kill se aceptan con su sintaxis y mensajes.'),
      note('Cada orden tiene un límite de 4 s de cálculo para que un bucle infinito no bloquee la página; al superarlo se interrumpe como con Ctrl+C.'),
      warn('Expansión del historial', 'El `!` se expande también dentro de comillas dobles y de un here-document pegado en la terminal: `echo "¡Hola!"` funciona, pero `"hola!x"` busca la orden «x…» («event not found»). Usa comillas simples o `set +H`.'),
      exercise('La errata', 'En la Terminal GNU/Linux de PC1, escribe `cat /etc/hostnmae` (con la errata) y corrígela sin volver a escribir la orden.', 'Sale «cat: /etc/hostnmae: No such file or directory». `^nmae^name` repite la orden corregida: bash muestra «cat /etc/hostname» y después su contenido, pc1.'),
    ],
  },
  {
    id: 'bash-53',
    title: 'bash: novedades de la versión 5.3',
    summary: 'Lo nuevo de bash 5.3 respecto a 5.2 que también está en Netfix.',
    markdownBase: MD,
    blocks: [
      table(['Novedad', 'Ejemplo'], [
        ['Sustitución de órdenes sin subshell ${ …; }', 'x=1; y=${ x=2; echo $x; }; echo $x   # 2'],
        ['Sustitución con valor en REPLY ${| …; }', 'r=${| REPLY=$(date +%H); }'],
        ['GLOBSORT: orden de los comodines', 'GLOBSORT=-size; ls *'],
        ['compgen -V array', 'compgen -V cands -W "alfa beta" a; echo "${cands[@]}"'],
        ['source -p RUTA', 'source -p ./lib mod.sh'],
        ['BASH_MONOSECONDS', 'Reloj monotónico en segundos'],
        ['read -E (readline con completado)', 'read -E -p "fichero: " f'],
        ['array_expand_once (antes assoc_expand_once)', 'shopt -s array_expand_once'],
      ]),
      term('shell', 'alumno@pc1:~$ x=1; v=${ x=2; echo "dentro:$x"; }; echo "$v / $x"\ndentro:2 / 2'),
    ],
  },
  {
    id: 'bash-builtins',
    title: 'bash: órdenes internas',
    summary: 'Todas las órdenes internas de bash 5.3 con su sinopsis.',
    blocks: builtinBlocks(),
  },
];
