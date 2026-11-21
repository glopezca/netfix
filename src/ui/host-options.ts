/**
 * Host options an extension adds to `netfix.embed` and `netfix.lab` (S23): the host page gives a value for one of its
 * device kinds (a link, a list of classes); each mount turns it into what that kind's devices get as context
 * (Topology#setKindContext), whether the palette offers the kind, a step before its tool is picked and what happens
 * when the lab's last one goes. Values come from the host page: `parse` validates them and throws on a bad one.
 */

/** What one mount does with an option's value for its kind. */
export interface KindHost {
  /** Whether the palette offers the kind in this mount. */
  readonly offered: boolean;
  /** The context its devices get now (null: none yet). */
  readonly context: unknown;
  /** Before its place tool is picked: true to go on, false (cancelled) to stay, or the message why it cannot. */
  prepare?(): Promise<boolean | string>;
  /** After every change, whether one of its devices is in the lab; true when that changed `context`. */
  track?(present: boolean): boolean;
}

export interface HostOptionSpec<T = unknown> {
  /** The device kind (registered with net/device-kinds.ts) the option is for. */
  readonly kind: string;
  /** The host's value, checked (throws an Error naming the option). */
  parse(value: unknown): T;
  /** One per mount; `value` is null when the host did not give the option. */
  start(value: T | null): KindHost;
}

const specs = new Map<string, HostOptionSpec>();
const RESERVED = new Set(['toolbar', 'actions', 'locale', 'confirmUnsaved', 'palette', 'piles', 'missions', 'topology', 'restrictions', 'onChange']);

export function registerHostOption<T>(name: string, spec: HostOptionSpec<T>): void {
  if (!/^[a-z][A-Za-z0-9]*$/.test(name) || RESERVED.has(name)) throw new Error(`netfix: «${name}» no puede ser una opción del anfitrión`);
  if (specs.has(name)) throw new Error(`netfix: la opción «${name}» ya está registrada`);
  if ([...specs.values()].some((s) => s.kind === spec.kind)) throw new Error(`netfix: el tipo de equipo «${spec.kind}» ya tiene opción del anfitrión`);
  specs.set(name, Object.freeze({ ...spec }) as HostOptionSpec);
}

/** The registered option names, in registration order. */
export const hostOptionNames = (): readonly string[] => [...specs.keys()];

export const hostOption = (name: string): HostOptionSpec | undefined => specs.get(name);

/** The kind hosts of the page's mount (one mount per page, like the App). */
let current: ReadonlyMap<string, KindHost> = new Map();

/** A mount's kind hosts, keyed by kind: every registered option, given or not. They become the page's current ones. */
export function startKindHosts(values: Readonly<Record<string, unknown>>): ReadonlyMap<string, KindHost> {
  current = new Map([...specs].map(([name, s]) => [s.kind, s.start(Object.hasOwn(values, name) ? values[name] : null)]));
  return current;
}

/** Whether the palette may offer `kind` here: a kind with a host option only when this mount's host offers it. */
export function kindOffered(kind: string): boolean {
  const hosted = [...specs.values()].some((s) => s.kind === kind);
  return !hosted || (current.get(kind)?.offered ?? false);
}
