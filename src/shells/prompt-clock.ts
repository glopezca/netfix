/**
 * «Prompt con marca de fecha y hora»: a global setting of this browser (Configuración → Generales; off by default)
 * that the classroom can lock on or off. Linux gets it as a PS1 value; Windows as the prompt the
 * PowerShell `prompt` function of the statement prints (Get-Date "ddd MMM dd" / "HH:mm:ss", user@host, path, $ or #).
 */
import type { Host } from '../devices/host.ts';
import { strftime } from '../bash/prompt.ts';

/** PS1="\[\e[32m\]\d \[\e[36m\]\A \[\e[33m\]\u@\h:\w\$ \[\e[0m\]" */
export const LINUX_TIMESTAMP_PS1 = '\\[\\e[32m\\]\\d \\[\\e[36m\\]\\A \\[\\e[33m\\]\\u@\\h:\\w\\$ \\[\\e[0m\\]';

// PowerShell console colours as ANSI: DarkCyan, Green, White, Yellow; then the default colour.
const DARK_CYAN = '\x1b[36m';
const GREEN = '\x1b[92m';
const WHITE = '\x1b[97m';
const YELLOW = '\x1b[93m';
const RESET = '\x1b[0m';

/** The classroom lock: true/false forces the prompt on every device; undefined leaves the global setting. */
let forced: boolean | undefined;
/** Configuración → Generales (the interface loads it from the browser). */
let globalOn = false;

export function forceTimestampPrompt(value: boolean | undefined): void {
  forced = value;
}

/** Whether `host`'s terminals show the date and time in the prompt (the same for every device). */
export function timestampPromptOn(_host?: Host): boolean {
  return forced ?? globalOn;
}

export function setGlobalTimestampPrompt(on: boolean): void {
  globalOn = on;
}

/** What the PowerShell prompt function prints: "Thu Oct 22 18:28:05 ana@pc0 C:\home\ana$ " in its colours. */
export function windowsTimestampPrompt(now: number, user: string, computer: string, path: string, admin: boolean): string {
  const stamp = `${strftime('%a %b %d', now)} ${strftime('%H:%M:%S', now)} `;
  return `${DARK_CYAN}${stamp}${GREEN}${user}@${computer.toLowerCase()}${WHITE} ${YELLOW}${path}${RESET}${admin ? '#' : '$'} `;
}
