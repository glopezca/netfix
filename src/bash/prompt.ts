/** PS1/PS2/PS4 backslash escapes (before parameter expansion). */

export interface PromptInfo {
  readonly user: string;
  readonly host: string;
  readonly cwd: string;
  readonly home: string | undefined;
  readonly uid: number;
  readonly now: number;
  readonly historyNumber: number;
  readonly commandNumber: number;
  readonly jobs: number;
  readonly version: string;
  readonly release: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Subset of strftime used by \D{…} and the date command. */
export function strftime(fmt: string, ms: number): string {
  const d = new Date(ms);
  const h12 = d.getUTCHours() % 12 || 12;
  const map: Readonly<Record<string, string>> = {
    a: DAYS[d.getUTCDay()] ?? '', A: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()] ?? '',
    b: MONTHS[d.getUTCMonth()] ?? '', h: MONTHS[d.getUTCMonth()] ?? '', B: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()] ?? '',
    d: pad(d.getUTCDate()), e: String(d.getUTCDate()).padStart(2, ' '), m: pad(d.getUTCMonth() + 1), Y: String(d.getUTCFullYear()), y: pad(d.getUTCFullYear() % 100),
    H: pad(d.getUTCHours()), I: pad(h12), M: pad(d.getUTCMinutes()), S: pad(d.getUTCSeconds()), p: d.getUTCHours() < 12 ? 'AM' : 'PM',
    j: pad(Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1, 3), s: String(Math.floor(ms / 1000)), N: pad((ms % 1000) * 1_000_000, 9),
    u: String(d.getUTCDay() || 7), w: String(d.getUTCDay()), Z: 'UTC', z: '+0000', n: '\n', t: '\t', '%': '%',
  };
  return fmt.replace(/%([a-zA-Z%])/g, (m, c: string) => {
    if (c === 'F') return `${map.Y}-${map.m}-${map.d}`;
    if (c === 'T') return `${map.H}:${map.M}:${map.S}`;
    if (c === 'D') return `${map.m}/${map.d}/${map.y}`;
    if (c === 'R') return `${map.H}:${map.M}`;
    if (c === 'c') return `${map.a} ${map.b} ${map.e} ${map.H}:${map.M}:${map.S} ${map.Y}`;
    if (c === 'x') return `${map.m}/${map.d}/${map.y}`;
    if (c === 'X') return `${map.H}:${map.M}:${map.S}`;
    return map[c] ?? m;
  });
}

function tildeCwd(cwd: string, home: string | undefined): string {
  if (home && home !== '/' && (cwd === home || cwd.startsWith(`${home}/`))) return `~${cwd.slice(home.length)}`;
  return cwd;
}

export function promptEscapes(ps: string, info: PromptInfo): string {
  return ps.replace(/\\(D\{[^}]*\}|[0-7]{3}|.)/g, (_m, c: string) => {
    if (c.startsWith('D{')) return strftime(c.slice(2, -1) || '%X', info.now);
    if (/^[0-7]{3}$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    const d = new Date(info.now);
    switch (c) {
      case 'a': return '\x07';
      case 'd': return strftime('%a %b %d', info.now);
      case 'e': return '\x1b';
      case 'h': return info.host.split('.')[0] ?? info.host;
      case 'H': return info.host;
      case 'j': return String(info.jobs);
      case 'l': return 'pts/0';
      case 'n': return '\n';
      case 'r': return '\r';
      case 's': return 'bash';
      case 't': return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      case 'T': return `${pad(d.getUTCHours() % 12 || 12)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      case '@': return `${pad(d.getUTCHours() % 12 || 12)}:${pad(d.getUTCMinutes())} ${d.getUTCHours() < 12 ? 'AM' : 'PM'}`;
      case 'A': return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      case 'u': return info.user;
      case 'v': return info.version;
      case 'V': return info.release;
      case 'w': return tildeCwd(info.cwd, info.home);
      case 'W': { const t = tildeCwd(info.cwd, info.home); return t === '/' || t === '~' ? t : t.slice(t.lastIndexOf('/') + 1); }
      case '!': return String(info.historyNumber);
      case '#': return String(info.commandNumber);
      case '$': return info.uid === 0 ? '#' : '$';
      case '\\': return '\\';
      case '[': case ']': return '';
      default: return `\\${c}`;
    }
  });
}
