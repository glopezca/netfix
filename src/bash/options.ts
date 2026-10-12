/** `set -o` options and `shopt` names with the defaults of an interactive bash 5.3 on Ubuntu. */

export const SET_OPTIONS = ['allexport', 'braceexpand', 'emacs', 'errexit', 'errtrace', 'functrace', 'hashall', 'histexpand', 'history', 'ignoreeof',
  'interactive-comments', 'keyword', 'monitor', 'noclobber', 'noexec', 'noglob', 'nolog', 'notify', 'nounset', 'onecmd', 'physical', 'pipefail',
  'posix', 'privileged', 'verbose', 'vi', 'xtrace'] as const;
export type SetOption = (typeof SET_OPTIONS)[number];
export const SET_LETTERS: Readonly<Record<string, SetOption>> = {
  a: 'allexport', B: 'braceexpand', e: 'errexit', E: 'errtrace', T: 'functrace', h: 'hashall', H: 'histexpand', m: 'monitor', C: 'noclobber',
  n: 'noexec', f: 'noglob', b: 'notify', u: 'nounset', t: 'onecmd', P: 'physical', p: 'privileged', v: 'verbose', x: 'xtrace', k: 'keyword',
};

export const SHOPT_ON = ['checkwinsize', 'cmdhist', 'complete_fullquote', 'expand_aliases', 'extglob', 'extquote', 'force_fignore', 'globasciiranges', 'globskipdots',
  'histappend', 'hostcomplete', 'interactive_comments', 'patsub_replacement', 'progcomp', 'promptvars', 'sourcepath'];
export const SHOPT_OFF = ['array_expand_once', 'assoc_expand_once', 'autocd', 'bash_source_fullpath', 'cdable_vars', 'cdspell', 'checkhash', 'checkjobs', 'direxpand',
  'dirspell', 'dotglob', 'execfail', 'extdebug', 'failglob', 'globstar', 'gnu_errfmt', 'histreedit', 'histverify', 'huponexit', 'inherit_errexit',
  'lastpipe', 'lithist', 'localvar_inherit', 'localvar_unset', 'login_shell', 'mailwarn', 'no_empty_cmd_completion', 'nocaseglob', 'nocasematch',
  'noexpand_translation', 'nullglob', 'progcomp_alias', 'restricted_shell', 'shift_verbose', 'varredir_close', 'xpg_echo'];
