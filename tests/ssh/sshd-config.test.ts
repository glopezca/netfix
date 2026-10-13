/** /etc/ssh/sshd_config parsing: first value wins, cumulative lists, Include, comments, limits and setDirective. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSshdConfig, setDirective, DEFAULT_SSHD_CONFIG, SSHD_CONFIG } from '../../src/services/sshd-config.ts';
import type { ConfigSource } from '../../src/services/sshd-config.ts';

function source(files: Record<string, string>): ConfigSource & { reads: number } {
  const src = {
    reads: 0,
    read(path: string): string | null {
      src.reads++;
      return files[path] ?? null;
    },
    list(dir: string): string[] {
      return Object.keys(files).filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1));
    },
  };
  return src;
}

const parse = (main: string, extra: Record<string, string> = {}) => parseSshdConfig(source({ [SSHD_CONFIG]: main, ...extra }));

test('the default Ubuntu file parses to the OpenSSH defaults', () => {
  const r = parse(DEFAULT_SSHD_CONFIG);
  assert.ok(r.ok);
  assert.equal(r.ok && r.settings.passwordAuth, true);
  assert.equal(r.ok && r.settings.permitRootLogin, 'prohibit-password');
});

test('first value wins; drop-ins included first override the main file; trailing comments', () => {
  const r = parse('Include /etc/ssh/sshd_config.d/*.conf\nPasswordAuthentication yes # main\nPubkeyAuthentication=no', {
    '/etc/ssh/sshd_config.d/50-cloud.conf': 'PasswordAuthentication no   # cloud-init\n',
  });
  assert.ok(r.ok);
  assert.equal(r.ok && r.settings.passwordAuth, false);
  assert.equal(r.ok && r.settings.pubkeyAuth, false);
});

test('AllowUsers and DenyUsers accumulate over lines and files', () => {
  const r = parse('Include /etc/ssh/sshd_config.d/*.conf\nDenyUsers alice\nDenyUsers bob\nAllowUsers admin', { '/etc/ssh/sshd_config.d/x.conf': 'DenyUsers carol' });
  assert.deepEqual(r.ok && r.settings.denyUsers, ['carol', 'alice', 'bob']);
  assert.deepEqual(r.ok && r.settings.allowUsers, ['admin']);
});

test('errors: unknown keyword, bad value, Match and unsupported security directives', () => {
  assert.deepEqual(parse('Nonsense yes'), { ok: false, error: `${SSHD_CONFIG}: line 1: Bad configuration option: Nonsense` });
  assert.match(parse('PasswordAuthentication maybe').ok ? '' : 'unsupported', /unsupported/);
  assert.match(parse('PermitRootLogin sometimes').ok ? '' : 'x', /x/);
  for (const line of ['Match User ana', 'ForceCommand /bin/false', 'ChrootDirectory /srv']) {
    const r = parse(`PasswordAuthentication yes\n${line}`);
    assert.equal(r.ok, false, line);
    assert.match(r.ok ? '' : r.error, /Unsupported option/);
  }
  assert.equal(parse('PermitRootLogin no').ok && parse('PermitRootLogin no').ok, true);
});

test('Include fan-out is bounded and each file is read once', () => {
  const files: Record<string, string> = {};
  const fan = Array.from({ length: 40 }, () => '/etc/ssh/a/*.conf').join(' ');
  for (let i = 0; i < 40; i++) files[`/etc/ssh/a/${i}.conf`] = `Include ${Array.from({ length: 40 }, () => '/etc/ssh/b/*.conf').join(' ')}`;
  for (let i = 0; i < 40; i++) files[`/etc/ssh/b/${i}.conf`] = 'PasswordAuthentication no';
  const src = source({ [SSHD_CONFIG]: `Include ${fan}`, ...files });
  const r = parseSshdConfig(src);
  assert.equal(r.ok, false, 'over the total budget');
  assert.match(r.ok ? '' : r.error, /Too many recursive configuration includes/);
  assert.ok(src.reads < 100, `reads=${src.reads}`);
  assert.equal(parse('Include /etc/ssh/sshd_config').ok, true, 'self-include is skipped');
});

test('AuthorizedKeysFile none disables key files; Include lines with too many patterns fail', () => {
  const r = parse('AuthorizedKeysFile none');
  assert.deepEqual(r.ok && r.settings.authorizedKeysFiles, []);
  const many = Array.from({ length: 1000 }, (_, i) => `/etc/ssh/x/${i}.conf`).join(' ');
  const t0 = Date.now();
  assert.equal(parse(`Include ${many}`).ok, false);
  assert.ok(Date.now() - t0 < 200);
});

test('setDirective replaces, uncomments next to the default, or appends', () => {
  assert.equal(setDirective('#PasswordAuthentication yes\n', 'PasswordAuthentication', 'no'), '#PasswordAuthentication yes\nPasswordAuthentication no\n');
  assert.equal(setDirective('PasswordAuthentication yes', 'PasswordAuthentication', 'no'), 'PasswordAuthentication no');
  assert.equal(setDirective('Port 22', 'PubkeyAuthentication', 'yes'), 'Port 22\nPubkeyAuthentication yes');
});
