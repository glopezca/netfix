/** Simulated wall clock shared by a topology. Times are epoch milliseconds (UTC). */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NOON = 12;

export class SimClock {
  private offsetMs = 0;
  private simElapsedMs = 0;
  private readonly baseMs: number;

  constructor(baseMs: number = Date.now()) {
    this.baseMs = baseMs;
  }

  now(): number {
    return this.baseMs + this.simElapsedMs + this.offsetMs;
  }

  /** Simulation time since start; drives the event queue. */
  elapsed(): number {
    return this.simElapsedMs;
  }

  advanceTo(elapsedMs: number): void {
    if (elapsedMs > this.simElapsedMs) this.simElapsedMs = elapsedMs;
  }

  /** `clock set` — changes wall time without moving the event queue. */
  set(epochMs: number): void {
    this.offsetMs = epochMs - this.baseMs - this.simElapsedMs;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "*11:31:05.123 UTC Sat Oct 10 2026" as printed by `show clock`. */
export function formatShowClock(epochMs: number): string {
  const d = new Date(epochMs);
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
  return `*${time} UTC ${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

/** "Oct 11 2026 11:31 AM" as printed in DHCP binding/conflict tables. */
export function formatLeaseTime(epochMs: number): string {
  const d = new Date(epochMs);
  const h24 = d.getUTCHours();
  const h12 = h24 % NOON === 0 ? NOON : h24 % NOON;
  const ampm = h24 < NOON ? 'AM' : 'PM';
  return `${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCDate())} ${d.getUTCFullYear()} ${pad2(h12)}:${pad2(d.getUTCMinutes())} ${ampm}`;
}

/** Parses `clock set hh:mm:ss day month year` arguments. Returns epoch ms or null. */
export function parseClockSet(time: string, day: string, month: string, year: string): number | null {
  const t = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(time);
  const monthIdx = MONTHS.findIndex((m) => m.toLowerCase() === month.slice(0, 3).toLowerCase());
  if (!t || monthIdx < 0) return null;
  const [h, mi, s] = [Number(t[1]), Number(t[2]), Number(t[3])];
  if (h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(Number(year), monthIdx, Number(day), h, mi, s);
  return new Date(ms).getUTCDate() === Number(day) ? ms : null;
}

export const MONTH_NAMES = MONTHS;
