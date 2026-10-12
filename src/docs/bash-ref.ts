/** Documentación: referencia de bash (variables, prompt, opciones, arranque, historial, trabajos, novedades 5.3 y órdenes internas). */
import type { DocBlock, DocPage } from './types.ts';
import { code, h, list, note, p, table } from './types.ts';
import { BUILTIN_DOCS } from './bash-builtins.ts';

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
    blocks: [
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
    ],
  },
  {
    id: 'bash-opciones',
    title: 'bash: opciones y ficheros de arranque',
    summary: 'set -euxo pipefail, shopt y qué ficheros lee bash al empezar.',
    blocks: [
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
        'Shell interactivo normal (la Terminal Linux, bash): /etc/bash.bashrc y ~/.bashrc.',
        'Scripts (bash script.sh, ./script.sh con #!): no leen ningún fichero.',
        '~/.bashrc de Ubuntu: prompt en color, HISTCONTROL=ignoreboth, alias ls/grep con color, ll, la y l.',
        'command_not_found_handle (en /etc/bash.bashrc) sugiere el paquete: «Command \'ifconfig\' not found, but can be installed with: sudo apt install net-tools».',
      ),
    ],
  },
  {
    id: 'bash-interactivo',
    title: 'bash: teclado, historial y trabajos',
    summary: 'Teclas de la terminal, expansión del historial (!), alias y control de trabajos.',
    blocks: [
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
      p('orden & arranca un trabajo en segundo plano. En netsim no hay procesos reales: el trabajo termina al momento y bash avisa con [1]+ Done antes del siguiente prompt. jobs, wait, fg, bg, disown y kill se aceptan con su sintaxis y mensajes.'),
      note('Cada orden tiene un límite de 4 s de cálculo para que un bucle infinito no bloquee la página; al superarlo se interrumpe como con Ctrl+C.'),
    ],
  },
  {
    id: 'bash-53',
    title: 'bash: novedades de la versión 5.3',
    summary: 'Lo nuevo de bash 5.3 respecto a 5.2 que también está en netsim.',
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
      code('$ x=1\n$ v=${ x=2; echo "dentro:$x"; }\n$ echo "$v / $x"\ndentro:2 / 2'),
    ],
  },
  {
    id: 'bash-builtins',
    title: 'bash: órdenes internas',
    summary: 'Todas las órdenes internas de bash 5.3 con su sinopsis.',
    blocks: builtinBlocks(),
  },
];
