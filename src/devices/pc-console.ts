/** Compatibility wrapper: one-shot Windows Command Prompt command on a host. */
import type { Host } from './host.ts';
import { WindowsShell } from '../shells/windows.ts';

export function pcCommand(host: Host, line: string): string[] {
  return new WindowsShell(host, 'user').run(line);
}
