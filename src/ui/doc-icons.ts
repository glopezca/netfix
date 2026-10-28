/**
 * Topic icons of the help (networking concepts, the terminal, bash scripts), drawn like the palette symbols: same
 * 64 × 48 box, the same colour variables (--dev-*) and line weights, so they sit beside the device icons.
 */

const NETWORK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">
  <g stroke="var(--dev-edge)" stroke-width="2" stroke-linecap="round">
    <path d="M32 24 L12 10 M32 24 L52 10 M32 24 L12 38 M32 24 L52 38 M12 10 L52 10"/>
  </g>
  <g fill="var(--dev-side)" stroke="var(--dev-edge)" stroke-width="1.5">
    <circle cx="12" cy="10" r="6"/><circle cx="52" cy="10" r="6"/><circle cx="12" cy="38" r="6"/><circle cx="52" cy="38" r="6"/>
  </g>
  <circle cx="32" cy="24" r="8" fill="var(--dev-top)" stroke="var(--dev-edge)" stroke-width="1.5"/>
  <circle cx="32" cy="24" r="2.6" fill="var(--dev-mark)"/>
</svg>`;

const TERMINAL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">
  <rect x="6" y="5" width="52" height="38" rx="3" fill="var(--dev-screen)" stroke="var(--dev-edge)" stroke-width="1.5"/>
  <path d="M6 13 h52" stroke="var(--dev-edge)" stroke-width="1.5"/>
  <path d="M6 13 v-5 a3 3 0 0 1 3 -3 h46 a3 3 0 0 1 3 3 v5 z" fill="var(--dev-top)"/>
  <g fill="var(--dev-port)"><circle cx="12" cy="9" r="1.6"/><circle cx="17" cy="9" r="1.6"/><circle cx="22" cy="9" r="1.6"/></g>
  <g stroke="var(--dev-mark)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M14 21 l7 6 l-7 6"/><path d="M26 34 h12"/>
  </g>
</svg>`;

const SCRIPT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">
  <path d="M16 3 h24 l10 10 v32 h-34 z" fill="var(--dev-side)" stroke="var(--dev-edge)" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M40 3 v10 h10" fill="var(--dev-top)" stroke="var(--dev-edge)" stroke-width="1.5" stroke-linejoin="round"/>
  <g stroke="var(--dev-mark)" stroke-width="2" stroke-linecap="round" fill="none">
    <path d="M24 12 l-2 8 M29 12 l-2 8 M20.5 14.7 h9.5 M19.8 17.6 h9.5 M34 12 v5"/>
  </g>
  <circle cx="34" cy="20" r="1.3" fill="var(--dev-mark)"/>
  <g stroke="var(--dev-port)" stroke-width="2.2" stroke-linecap="round">
    <path d="M21 26 h22 M24 31 h15 M24 36 h18 M21 41 h10"/>
  </g>
</svg>`;

/** The topic icons by name (the device ones come from ICONS). */
export const TOPIC_ICONS: Readonly<Record<'network' | 'terminal' | 'script', string>> = { network: NETWORK, terminal: TERMINAL, script: SCRIPT };
