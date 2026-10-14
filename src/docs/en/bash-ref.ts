/** Documentation: bash reference (variables, prompt, options, startup, history, jobs, what’s new in 5.3 and builtins). */
import type { DocBlock, DocPage } from '../types.ts';
import { code, h, list, note, p, table } from '../types.ts';
import { BUILTIN_DOCS } from './bash-builtins.ts';

function builtinBlocks(): DocBlock[] {
  const names = Object.keys(BUILTIN_DOCS).sort((a, b) => a.localeCompare(b));
  const blocks: DocBlock[] = [
    p('Builtin commands run inside the shell. help shows the help for each one (help -s: synopsis only; help -d: the short description); type tells whether a name is a reserved word, an alias, a function, a builtin or a program.'),
    table(['Command', 'Synopsis', 'Description'], names.map((n) => [n, BUILTIN_DOCS[n]?.synopsis ?? '', BUILTIN_DOCS[n]?.summary ?? ''])),
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
    title: 'bash: special variables and prompt',
    summary: 'Special parameters, shell variables and PS1 sequences.',
    blocks: [
      table(['Variable', 'Contents'], [
        ['$? · $$ · $! · $- · $_', 'Status of the last command · shell PID · PID of the last background job · enabled options · last argument'],
        ['BASH_VERSION · BASH_VERSINFO', '5.3.20(1)-release · (5 3 20 1 release x86_64-pc-linux-gnu)'],
        ['BASHPID · PPID · UID · EUID · GROUPS', 'Process and user identifiers'],
        ['HOME · USER · LOGNAME · SHELL · PATH · PWD · OLDPWD', 'Session environment'],
        ['HOSTNAME · HOSTTYPE · OSTYPE · MACHTYPE', 'Machine data'],
        ['RANDOM · SRANDOM · SECONDS · EPOCHSECONDS · EPOCHREALTIME · BASH_MONOSECONDS', 'Random numbers and time'],
        ['LINENO · FUNCNAME · BASH_SOURCE · BASH_LINENO · BASH_COMMAND', 'Debugging'],
        ['PIPESTATUS · BASH_REMATCH · REPLY · OPTARG · OPTIND', 'Results of pipelines, [[ =~ ]], read and getopts'],
        ['IFS · PS1 · PS2 · PS4 · PROMPT_COMMAND', 'Separators and prompts'],
        ['HISTFILE · HISTSIZE · HISTFILESIZE · HISTCONTROL · HISTTIMEFORMAT', 'History'],
        ['SHLVL · BASH_SUBSHELL · COLUMNS · LINES · TERM · LANG', 'Nesting and terminal'],
        ['GLOBSORT · FUNCNEST · CDPATH', 'Behaviour'],
      ]),
      h('Prompt sequences (PS1)'),
      table(['Sequence', 'Replaced by'], [
        ['\\u · \\h · \\H', 'user · short host name · full host name'],
        ['\\w · \\W', 'current directory (~ for $HOME) · only its last component'],
        ['\\$', '# for root, $ for everyone else'],
        ['\\d · \\t · \\T · \\@ · \\A · \\D{fmt}', 'date and times (strftime)'],
        ['\\s · \\v · \\V · \\# · \\! · \\j', 'shell, version, command no., history no., jobs'],
        ['\\n · \\e · \\[ … \\]', 'newline, ESC, delimit colour sequences'],
      ]),
      code("PS1='\\[\\e[01;32m\\]\\u@\\h\\[\\e[00m\\]:\\[\\e[01;34m\\]\\w\\[\\e[00m\\]\\$ '   # Ubuntu’s default"),
    ],
  },
  {
    id: 'bash-opciones',
    title: 'bash: options and startup files',
    summary: 'set -euxo pipefail, shopt and which files bash reads when it starts.',
    blocks: [
      table(['set', 'Effect'], [
        ['-e (errexit)', 'Ends the script if a command fails (except in conditions, && and ||).'],
        ['-u (nounset)', 'Error when using an unset variable.'],
        ['-x (xtrace)', 'Shows each expanded command with PS4 (+) before running it.'],
        ['-o pipefail', 'A pipeline fails if any of its commands fails.'],
        ['-f (noglob) · -C (noclobber) · -n (noexec) · -v (verbose) · -a (allexport)', 'Wildcards, overwriting, parse only, echo input, export everything'],
        ['-H (histexpand) · -m (monitor) · -b · -h · -k · -P · -T · -E', 'History with !, job control and others (accepted)'],
      ]),
      h('shopt'),
      table(['Option', 'Effect'], [
        ['extglob · globstar · dotglob · nullglob · failglob · nocaseglob · globasciiranges', 'Wildcards'],
        ['nocasematch', 'case and [[ == ]] ignore case'],
        ['expand_aliases', 'Expands aliases (on in interactive shells)'],
        ['lastpipe', 'The last command of a pipeline runs in the current shell'],
        ['patsub_replacement', '& in ${v/pat/rep} is the match (on by default)'],
        ['cmdhist · lithist · histappend', 'How multi-line commands are saved'],
        ['login_shell (read-only) · checkwinsize · sourcepath · xpg_echo · localvar_inherit', 'Miscellaneous'],
      ]),
      h('Startup files'),
      list(
        'Login shell (SSH, sudo -i, su -, bash -l): /etc/profile and then ~/.profile, which loads ~/.bashrc. On exit, ~/.bash_logout.',
        'Normal interactive shell (the Linux Terminal, bash): /etc/bash.bashrc and ~/.bashrc.',
        'Scripts (bash script.sh, ./script.sh with #!): read no files.',
        'Ubuntu’s ~/.bashrc: coloured prompt, HISTCONTROL=ignoreboth, ls/grep aliases with colour, ll, la and l.',
        'command_not_found_handle (in /etc/bash.bashrc) suggests the package: “Command \'ifconfig\' not found, but can be installed with: sudo apt install net-tools”.',
      ),
    ],
  },
  {
    id: 'bash-interactivo',
    title: 'bash: keyboard, history and jobs',
    summary: 'Terminal keys, history expansion (!), aliases and job control.',
    blocks: [
      table(['Key', 'Action'], [
        ['Tab · Tab Tab', 'Completes commands, files and $variables · lists the options'],
        ['↑ ↓', 'Terminal history'],
        ['Ctrl+C', 'Interrupts the command (status 130) or discards the line'],
        ['Ctrl+D', 'End of input (read, cat); on an empty line, exits the shell (“exit” / “logout”)'],
        ['Ctrl+L', 'Clears the screen (like clear)'],
      ]),
      h('History expansion'),
      table(['Form', 'Replaced by'], [
        ['!! · !n · !-n', 'the last command · command n · the nth previous one'],
        ['!texto · !?texto?', 'the last one that starts with / contains text'],
        ['!$ · !^ · !* · !:n', 'last argument · first · all · the nth'],
        ['^viejo^nuevo', 'repeats the last one replacing old with new'],
        [':p · :s/a/b/ · :h · :t · :r · :e', 'print only · substitute · path modifiers'],
      ]),
      p('history shows the history (HISTTIMEFORMAT adds the date); fc -l lists it and fc -s repeats. The history is saved in ~/.bash_history on exit.'),
      h('Jobs'),
      p('command & starts a job in the background. In Netfix there are no real processes: the job finishes at once and bash reports [1]+ Done before the next prompt. jobs, wait, fg, bg, disown and kill are accepted with their syntax and messages.'),
      note('Each command has a 4 s computation limit so that an infinite loop does not freeze the page; when exceeded it is interrupted as with Ctrl+C.'),
    ],
  },
  {
    id: 'bash-53',
    title: 'bash: what’s new in version 5.3',
    summary: 'What is new in bash 5.3 compared with 5.2 that is also in Netfix.',
    blocks: [
      table(['Feature', 'Example'], [
        ['Command substitution without a subshell ${ …; }', 'x=1; y=${ x=2; echo $x; }; echo $x   # 2'],
        ['Substitution with the value in REPLY ${| …; }', 'r=${| REPLY=$(date +%H); }'],
        ['GLOBSORT: wildcard ordering', 'GLOBSORT=-size; ls *'],
        ['compgen -V array', 'compgen -V cands -W "alfa beta" a; echo "${cands[@]}"'],
        ['source -p PATH', 'source -p ./lib mod.sh'],
        ['BASH_MONOSECONDS', 'Monotonic clock in seconds'],
        ['read -E (readline with completion)', 'read -E -p "file: " f'],
        ['array_expand_once (formerly assoc_expand_once)', 'shopt -s array_expand_once'],
      ]),
      code('$ x=1\n$ v=${ x=2; echo "dentro:$x"; }\n$ echo "$v / $x"\ndentro:2 / 2'),
    ],
  },
  {
    id: 'bash-builtins',
    title: 'bash: builtin commands',
    summary: 'All the bash 5.3 builtin commands with their synopsis.',
    blocks: builtinBlocks(),
  },
];
