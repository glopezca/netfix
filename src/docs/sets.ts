/**
 * The documentation of each language: groups of the Documentation tab, programs (man), bash builtins (help)
 * and the few texts of the generated manual pages. Spanish lives in src/docs, English in src/docs/en.
 */
import type { DocGroup, DocPage } from './types.ts';
import type { Locale } from '../i18n/locale.ts';
import type { UtilDoc } from './utils.ts';
import type { BuiltinDoc } from './bash-builtins.ts';
import { NETFIX_DOCS } from './netfix.ts';
import { SETTINGS_DOCS } from './settings.ts';
import { IOS_DOCS } from './ios.ts';
import { IOS_DHCP_DOCS } from './ios-dhcp.ts';
import { STP_DOCS } from './ios-stp.ts';
import { IOS_SEC_DOCS } from './ios-sec.ts';
import { SERVICE_DOCS } from './services.ts';
import { CLIENT_DOCS } from './clients.ts';
import { LINUX_DOCS } from './linux.ts';
import { BASH_LANGUAGE } from './bash-lang.ts';
import { BASH_REFERENCE } from './bash-ref.ts';
import { EDITOR_DOCS, NANO_KEYS, VIM_EX, VIM_KEYS } from './editors.ts';
import { UTIL_DOCS } from './utils.ts';
import { BUILTIN_DOCS } from './bash-builtins.ts';
import { INTERNET_DOCS } from './internet.ts';
import { WEBAPP_DOCS } from './webapps.ts';
import { SSH_DOCS } from './ssh.ts';
import { SECURITY_DOCS } from './security.ts';
import { DNS_DOCS } from './dns.ts';
import { HTTP_DOCS } from './http.ts';
import { MAIL_DOCS } from './mail.ts';
import { APT_DOCS } from './apt.ts';
import { NETFIX_DOCS as NETFIX_EN } from './en/netfix.ts';
import { SETTINGS_DOCS as SETTINGS_EN } from './en/settings.ts';
import { IOS_DOCS as IOS_EN } from './en/ios.ts';
import { IOS_DHCP_DOCS as IOS_DHCP_EN } from './en/ios-dhcp.ts';
import { STP_DOCS as STP_EN } from './en/ios-stp.ts';
import { IOS_SEC_DOCS as IOS_SEC_EN } from './en/ios-sec.ts';
import { SERVICE_DOCS as SERVICE_EN } from './en/services.ts';
import { CLIENT_DOCS as CLIENT_EN } from './en/clients.ts';
import { LINUX_DOCS as LINUX_EN } from './en/linux.ts';
import { BASH_LANGUAGE as BASH_LANGUAGE_EN } from './en/bash-lang.ts';
import { BASH_REFERENCE as BASH_REFERENCE_EN } from './en/bash-ref.ts';
import { EDITOR_DOCS as EDITOR_EN, NANO_KEYS as NANO_KEYS_EN, VIM_EX as VIM_EX_EN, VIM_KEYS as VIM_KEYS_EN } from './en/editors.ts';
import { UTIL_DOCS as UTIL_EN } from './en/utils.ts';
import { BUILTIN_DOCS as BUILTIN_EN } from './en/bash-builtins.ts';
import { INTERNET_DOCS as INTERNET_EN } from './en/internet.ts';
import { WEBAPP_DOCS as WEBAPP_EN } from './en/webapps.ts';
import { SSH_DOCS as SSH_EN } from './en/ssh.ts';
import { SECURITY_DOCS as SECURITY_EN } from './en/security.ts';
import { DNS_DOCS as DNS_EN } from './en/dns.ts';
import { HTTP_DOCS as HTTP_EN } from './en/http.ts';
import { MAIL_DOCS as MAIL_EN } from './en/mail.ts';
import { APT_DOCS as APT_EN } from './en/apt.ts';
import { NAMES_DOCS } from './names.ts';
import { NAMES_DOCS as NAMES_EN } from './en/names.ts';
import { OUTLINE } from './outline.ts';
import { arrange } from './arrange.ts';
import { OUTLINE as OUTLINE_EN } from './en/outline.ts';

type KeyTable = readonly (readonly [string, string])[];

/** Texts of the man pages that Netfix writes itself (the rest comes from the docs). */
export interface ManTexts {
  readonly seeAlso: string;
  readonly bashName: string;
  readonly bashSynopsis: string;
  readonly bashDescription: string;
  readonly bashHelp: string;
  /** First line of `help` without arguments. */
  readonly helpIntro: string;
  /** man of a bash builtin: «(cd is a bash builtin: try “help cd”)». */
  readonly builtinHint: (name: string) => string;
}

export interface DocSet {
  readonly groups: readonly DocGroup[];
  readonly utils: Readonly<Record<string, UtilDoc>>;
  readonly builtins: Readonly<Record<string, BuiltinDoc>>;
  readonly bashPages: readonly DocPage[];
  readonly nanoKeys: KeyTable;
  readonly vimKeys: KeyTable;
  readonly man: ManTexts;
}

const ES: DocSet = {
  groups: arrange(OUTLINE, [...NETFIX_DOCS.pages, ...SETTINGS_DOCS, ...IOS_DOCS.pages, ...STP_DOCS, ...IOS_DHCP_DOCS, ...IOS_SEC_DOCS, ...SERVICE_DOCS.pages, ...DNS_DOCS, ...HTTP_DOCS, ...MAIL_DOCS, ...SSH_DOCS, ...WEBAPP_DOCS, ...INTERNET_DOCS.pages,
    ...SECURITY_DOCS.pages, ...CLIENT_DOCS.pages, ...LINUX_DOCS, ...APT_DOCS, ...NAMES_DOCS, ...EDITOR_DOCS, ...BASH_LANGUAGE, ...BASH_REFERENCE]),
  utils: UTIL_DOCS,
  builtins: BUILTIN_DOCS,
  bashPages: [...BASH_LANGUAGE, ...BASH_REFERENCE],
  nanoKeys: NANO_KEYS,
  vimKeys: [...VIM_KEYS, ...VIM_EX],
  man: {
    seeAlso: 'La pestaña Ayuda de Netfix tiene ejemplos y la referencia completa.',
    bashName: 'bash - GNU Bourne-Again SHell (versión 5.3.20 en Netfix)',
    bashSynopsis: 'bash [opciones] [orden_o_fichero ...]',
    bashDescription: 'Intérprete de órdenes compatible con sh que ejecuta lo que se escribe en la terminal o se lee de un fichero. La referencia completa está en la pestaña Ayuda:',
    bashHelp: 'Usa «help orden» para ver cada una.',
    helpIntro: 'Órdenes internas (builtins). Escribe `help nombre` para ver una, o abre la pestaña Ayuda.',
    builtinHint: (n) => `(${n} es una orden interna de bash: prueba «help ${n}»)`,
  },
};

const EN: DocSet = {
  groups: arrange(OUTLINE_EN, [...NETFIX_EN.pages, ...SETTINGS_EN, ...IOS_EN.pages, ...STP_EN, ...IOS_DHCP_EN, ...IOS_SEC_EN, ...SERVICE_EN.pages, ...DNS_EN, ...HTTP_EN, ...MAIL_EN, ...SSH_EN, ...WEBAPP_EN, ...INTERNET_EN.pages,
    ...SECURITY_EN.pages, ...CLIENT_EN.pages, ...LINUX_EN, ...APT_EN, ...NAMES_EN, ...EDITOR_EN, ...BASH_LANGUAGE_EN, ...BASH_REFERENCE_EN]),
  utils: UTIL_EN,
  builtins: BUILTIN_EN,
  bashPages: [...BASH_LANGUAGE_EN, ...BASH_REFERENCE_EN],
  nanoKeys: NANO_KEYS_EN,
  vimKeys: [...VIM_KEYS_EN, ...VIM_EX_EN],
  man: {
    seeAlso: 'The Help tab of Netfix has examples and the full reference.',
    bashName: 'bash - GNU Bourne-Again SHell (version 5.3.20 in Netfix)',
    bashSynopsis: 'bash [options] [command_or_file ...]',
    bashDescription: 'An sh-compatible command interpreter that runs what is typed in the terminal or read from a file. The full reference is in the Help tab:',
    bashHelp: 'Use “help command” to see each one.',
    helpIntro: 'Shell builtins. Type `help name` to see one, or open the Help tab.',
    builtinHint: (n) => `(${n} is a bash builtin: try “help ${n}”)`,
  },
};

const SETS: Readonly<Record<Locale, DocSet>> = { 'es-ES': ES, 'en-GB': EN };

export function docSet(locale: Locale): DocSet {
  return SETS[locale];
}
