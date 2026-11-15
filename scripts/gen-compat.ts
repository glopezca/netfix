// Regenerates tests/fixtures/v<X>/ from a checkout of tag v<X>. usage: node scripts/gen-compat.ts <checkout> <outdir> [hosts]
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [root, out, hosts] = process.argv.slice(2);
const load = (p: string) => import(pathToFileURL(`${root}/src/${p}`).href);
const { EXAMPLES } = await load('net/examples.ts');
mkdirSync(out, { recursive: true });
for (const ex of EXAMPLES) writeFileSync(`${out}/${ex.id}.json`, JSON.stringify(ex.build().toJSON(), null, 1) + '\n');
if (hosts) {
  const { Topology } = await load('net/topology.ts');
  const { createShell } = await load('shells/factory.ts');
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device;
  pc.setStatic({ ip: 0x0a000002, prefix: 24 });
  createShell(pc, 'linux', 'root').run("mkdir -p /Windows/System32/drivers/etc; echo '10.0.0.7 impresora' > /Windows/System32/drivers/etc/hosts");
  writeFileSync(`${out}/hosts-legacy.json`, JSON.stringify(t.toJSON(), null, 1) + '\n');
}
