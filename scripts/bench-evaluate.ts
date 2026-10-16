/**
 * CPU of the headless marking per lab (classroom phase 2): loading the file (settles 30 s of simulated time) and a
 * checklist with every check type. Run with `npm run bench:evaluate`; prints a table in milliseconds.
 */
import { EXAMPLES } from '../src/net/examples.ts';
import { Host } from '../src/devices/host.ts';
import { IosDevice } from '../src/ios/device.ts';
import { formatIp } from '../src/core/ip.ts';
import { Topology } from '../src/net/topology.ts';
import { parseChecklist } from '../src/classroom/checklist.ts';
import { evaluate } from '../src/classroom/evaluate.ts';

const RUNS = 5;

function checklistFor(t: Topology): unknown[] {
  const placed = [...t.placed.values()];
  const hosts = placed.filter((p) => p.device instanceof Host);
  const ios = placed.find((p) => p.device instanceof IosDevice);
  const items: unknown[] = placed.map((p, i) => ({ id: `d${i}`, check: { type: 'device', device: p.label } }));
  hosts.forEach((p, i) => {
    const h = p.device as Host;
    const gw = h.config.gateway;
    items.push({ id: `ip${i}`, check: { type: 'ip', device: p.label } });
    if (gw !== undefined) items.push({ id: `ping${i}`, check: { type: 'ping', from: p.label, to: formatIp(gw) } });
    items.push({ id: `dns${i}`, check: { type: 'dns', from: p.label, name: 'www.example.com' } });
    items.push({ id: `http${i}`, check: { type: 'http', from: p.label, url: 'http://www.example.com/' } });
    items.push({ id: `file${i}`, check: { type: 'file', device: p.label, path: '/etc/hosts' } });
  });
  if (ios) items.push({ id: 'cfg', check: { type: 'config', device: ios.label, lines: ['hostname X'] } });
  return items;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

const rows: string[] = ['lab               devices  checks  load ms  total ms'];
for (const ex of EXAMPLES) {
  const t = ex.build();
  if (t.placed.size === 0) continue;
  const file = JSON.parse(JSON.stringify(t.toJSON()));
  const list = parseChecklist(checklistFor(t));
  const load: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const a = performance.now();
    Topology.fromJSON(file);
    const b = performance.now();
    evaluate(file, list);
    load.push(b - a);
    total.push(performance.now() - b);
  }
  rows.push(`${ex.id.padEnd(18)}${String(t.placed.size).padStart(7)}${String(list.length).padStart(8)}${median(load).toFixed(0).padStart(9)}${median(total).toFixed(0).padStart(10)}`);
}
process.stdout.write(`${rows.join('\n')}\n`);
