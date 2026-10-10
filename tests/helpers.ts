import { Session } from '../src/ios/session.ts';
import type { IosDevice } from '../src/ios/device.ts';

export interface Console {
  readonly session: Session;
  run(...lines: string[]): string[];
  logs: string[];
}

/** Opens a privileged console on a device; `run` returns the output of the last line. */
export function openConsole(device: IosDevice, mode: 'user' | 'exec' | 'config' = 'exec'): Console {
  const session = new Session(device);
  session.mode = mode;
  const logs: string[] = [];
  device.onConsole((l) => logs.push(l));
  return {
    session,
    logs,
    run(...lines: string[]): string[] {
      let out: string[] = [];
      for (const line of lines) out = session.input(line);
      return out;
    },
  };
}

/** Runs all lines and returns the concatenated output. */
export function runAll(c: Console, lines: readonly string[]): string[] {
  return lines.flatMap((l) => c.session.input(l));
}
