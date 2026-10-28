/** Documentation: bash reference (variables, prompt, options, startup, history, jobs, what’s new in 5.3 and builtins). */
import type { DocBlock, DocPage } from '../types.ts';
import { code, exercise, h, list, note, p, steps, table, term, tip, warn } from '../types.ts';
import { BUILTIN_DOCS } from './bash-builtins.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

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
    markdownBase: MD,
    blocks: [
      p('bash keeps information in **special variables**: the last command’s status (`$?`), the arguments (`$1`, `$#`…), the version, the directory… One of them, **PS1**, is the text of the **prompt**: changing it is the quickest way to see how they work.'),
      steps(
        ['Look at the status', '`false; echo $?` gives 1; in a pipeline, `${PIPESTATUS[@]}` keeps each command’s.'],
        ['Try a prompt', "`PS1='\\u en \\W\\$ '`: the change is immediate, but only lasts this session."],
        ['Make it permanent', 'Add it at the end of `~/.bashrc` and reload it with `source ~/.bashrc`.'],
      ),
      term('shell', "alumno@pc1:~$ false | true; echo \"${PIPESTATUS[@]}\"\n1 0\nalumno@pc1:~$ echo $BASH_VERSION\n5.3.20(1)-release\nalumno@pc1:~$ PS1='\\u en \\W\\$ '\nalumno en ~$ cd /etc\nalumno en etc$ cd"),
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
      tip('Backup', 'Before touching `~/.bashrc`, `cp ~/.bashrc ~/.bashrc.bak`: if the prompt ends up broken, `cp ~/.bashrc.bak ~/.bashrc` and open another terminal.'),
      exercise('Your prompt', 'In PC1’s Linux Terminal, make the prompt show user@host and the full path, and keep it in later sessions.', "`echo 'PS1=\"\\u@\\h:\\w\\$ \"' >> ~/.bashrc` and `source ~/.bashrc`. After `cd /var/log` the prompt is “alumno@pc1:/var/log$”. \\w is the full path (with ~ for your home) and \\W only its last component."),
    ],
  },
  {
    id: 'bash-opciones',
    title: 'bash: options and startup files',
    summary: 'set -euxo pipefail, shopt and which files bash reads when it starts.',
    markdownBase: MD,
    blocks: [
      p('**Options** change how bash behaves. The `set` ones matter most in a script: stop at the first error, complain about unset variables and show what runs. The `shopt` ones fine-tune wildcards and history.'),
      steps(
        ['Stop at the first error', '`set -e`: if a command fails, the script ends with its status.'],
        ['No ghost variables', '`set -u`: using an unset variable is an error, not an empty string.'],
        ['Honest pipelines', '`set -o pipefail`: a pipeline fails if any of its commands fails, not just the last one.'],
        ['See what happens', '`set -x` shows each expanded command (or `bash -x script.sh`).'],
      ),
      term('shell', 'alumno@pc1:~$ printf "set -e\\nfalse\\necho nunca\\n" > e.sh; bash e.sh; echo "estado: $?"\nestado: 1\nalumno@pc1:~$ printf "set -o pipefail\\nfalse | true\\necho \\$?\\n" > p.sh; bash p.sh\n1\nalumno@pc1:~$ set -x; echo hola; set +x\n+ echo hola\nhola\n+ set +x'),
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
      warn('Careful with set -e', 'It does not fire inside conditions (`if orden`, `orden || …`, `&&`): there a failure is an answer, not an error. And in the interactive terminal, `set -e` closes the session at the first failure: use it in scripts.'),
      exercise('A script that does not carry on blindly', 'On PC1, write a script that runs `cd /noexiste` and then `rm -f *.tmp`. What happens without options, and what with `set -e` at the start?', 'Without options, `cd` fails (“No such file or directory”) and `rm` runs anyway in the current directory: exactly what you did not want. With `set -e` on the first line, the script ends at the `cd` with status 1 and `rm` never runs.'),
    ],
  },
  {
    id: 'bash-interactivo',
    title: 'bash: keyboard, history and jobs',
    summary: 'Terminal keys, history expansion (!), aliases and job control.',
    markdownBase: MD,
    blocks: [
      p('In the terminal, bash helps you type less: **Tab** completes, the arrows go through the **history** and `!` repeats earlier commands. It can also launch commands in the **background** with `&`.'),
      steps(
        ['Complete', 'Type the start of a command or a file and press **Tab** (twice if there are several options).'],
        ['Repeat', '`!!` repeats the last command; `!$` is its last argument.'],
        ['Correct', '`^old^new` repeats the last one changing a text: ideal for a typo.'],
        ['In the background', '`orden &` gives the prompt back at once; `jobs` lists what is running.'],
      ),
      term('shell', 'alumno@pc1:~$ echo uno\nuno\nalumno@pc1:~$ !!\necho uno\nuno\nalumno@pc1:~$ ^uno^dos\necho dos\ndos'),
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
      warn('History expansion', 'The `!` is also expanded inside double quotes and in a here-document pasted into the terminal: `echo "¡Hola!"` works, but `"hola!x"` looks for the command “x…” (“event not found”). Use single quotes or `set +H`.'),
      exercise('The typo', 'In PC1’s Linux Terminal, type `cat /etc/hostnmae` (with the typo) and fix it without typing the command again.', 'You get “cat: /etc/hostnmae: No such file or directory”. `^nmae^name` repeats the corrected command: bash shows “cat /etc/hostname” and then its contents, pc1.'),
    ],
  },
  {
    id: 'bash-53',
    title: 'bash: what’s new in version 5.3',
    summary: 'What is new in bash 5.3 compared with 5.2 that is also in Netfix.',
    markdownBase: MD,
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
      term('shell', 'alumno@pc1:~$ x=1; v=${ x=2; echo "dentro:$x"; }; echo "$v / $x"\ndentro:2 / 2'),
    ],
  },
  {
    id: 'bash-builtins',
    title: 'bash: builtin commands',
    summary: 'All the bash 5.3 builtin commands with their synopsis.',
    blocks: builtinBlocks(),
  },
];
