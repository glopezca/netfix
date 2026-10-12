/** Roundcube webmail on a Server-PT, used from a PC browser (alias or own port), plus the browser engine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { BrowserEngine, originOf } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';
import { validateAccess } from '../../src/services/config.ts';

function lab(mode: 'alias' | 'port' = 'alias'): { t: Topology; srv: Server; pc: Pc; web: BrowserEngine } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24, dns: parseIp('10.0.0.2')! });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24, dns: parseIp('10.0.0.2')! });
  srv.setServices({
    ...srv.services,
    dns: { enabled: true, origin: 'aula.lab', records: [{ name: 'webmail', type: 'A', value: '10.0.0.2', ttl: 60 }, { name: 'www', type: 'A', value: '10.0.0.2', ttl: 60 }] },
    mail: { smtp: true, pop3: true, imap: true, domain: 'aula.lab', users: [{ name: 'ana', password: 'ana1' }, { name: 'luis', password: 'luis1' }] },
    webapps: { ...srv.services.webapps, roundcube: { enabled: true, mode, alias: '/roundcube', port: 8080 } },
  });
  t.settle();
  return { t, srv, pc, web: new BrowserEngine(pc) };
}

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : `${r.kind}`);

test('the login page is served on the alias; the default site keeps the root URL', () => {
  const { web } = lab();
  const r = web.open('http://www.aula.lab/roundcube/');
  assert.equal(r.kind, 'page');
  assert.match(body(r), /<title>Roundcube Webmail :: Bienvenido a Roundcube Webmail<\/title>/);
  assert.match(body(r), /<form method="post" action="\/roundcube\/\?_task=login">/);
  assert.match(body(web.open('http://www.aula.lab/')), /Servidor web de netsim/);
});

test('log in, read the inbox, compose and send (Sent folder and delivery), log out', () => {
  const { srv, web } = lab();
  srv.mailboxes.deliver('ana', { from: 'luis@aula.lab', to: ['ana@aula.lab'], subject: 'Hola <ana>', body: 'Reunión a las 10', date: 0 });
  const bad = web.open('http://webmail.aula.lab/roundcube/?_task=login', { method: 'POST', form: [['_user', 'ana'], ['_pass', 'mal']] });
  assert.match(body(bad), /Error de inicio de sesión/);
  const inbox = web.open('http://webmail.aula.lab/roundcube/?_task=login', { method: 'POST', form: [['_user', 'ana'], ['_pass', 'ana1']] });
  assert.equal(inbox.url, 'http://webmail.aula.lab/roundcube/?_task=mail&_mbox=INBOX');
  assert.match(body(inbox), /Hola &lt;ana&gt;/, 'subjects are escaped');
  assert.match(web.cookieHeader(inbox.url), /^roundcube_sessid=[0-9a-f]{32}$/);
  assert.match(body(web.open('http://webmail.aula.lab/roundcube/?_task=mail&_mbox=INBOX&_action=show&_uid=0')), /Reunión a las 10/);
  const sent = web.open('http://webmail.aula.lab/roundcube/?_task=mail&_action=send', { method: 'POST', form: [['_to', 'luis@aula.lab'], ['_subject', 'Re: Hola'], ['_message', 'Vale']] });
  assert.equal(sent.url, 'http://webmail.aula.lab/roundcube/?_task=mail&_mbox=Sent');
  assert.match(body(sent), /Re: Hola/);
  assert.equal(srv.mailboxes.list('luis')[0]?.body, 'Vale');
  assert.match(createShell(srv, 'linux', 'root').run('journalctl -u postfix').join('\n'), /to=<luis@aula\.lab>, relay=local, status=sent/);
  const out = web.open('http://webmail.aula.lab/roundcube/?_task=logout');
  assert.match(body(out), /Iniciar sesión/);
  assert.match(body(web.open('http://webmail.aula.lab/roundcube/?_task=mail&_mbox=Sent')), /_task=login/, 'the session has ended');
});

test('deleting moves to Trash; IMAP off or SMTP off give the Roundcube errors', () => {
  const { srv, pc, web } = lab();
  srv.mailboxes.deliver('ana', { from: 'x@aula.lab', to: ['ana@aula.lab'], subject: 'Borrar', body: '-', date: 0 });
  web.open('http://10.0.0.2/roundcube/?_task=login', { method: 'POST', form: [['_user', 'ana@aula.lab'], ['_pass', 'ana1']] });
  web.open('http://10.0.0.2/roundcube/?_task=mail&_action=delete&_uid=0&_mbox=INBOX');
  assert.equal(srv.mailboxes.list('ana').length, 0);
  assert.equal(srv.mailboxes.list('ana:Trash')[0]?.subject, 'Borrar');
  srv.setServices({ ...srv.services, mail: { ...srv.services.mail, smtp: false } });
  const r = web.open('http://10.0.0.2/roundcube/?_task=mail&_action=send', { method: 'POST', form: [['_to', 'luis@aula.lab'], ['_subject', 'x'], ['_message', 'y']] });
  assert.match(body(r), /Error SMTP: no se pudo conectar/);
  srv.setServices({ ...srv.services, mail: { ...srv.services.mail, imap: false } });
  const fresh = new BrowserEngine(pc);
  assert.match(body(fresh.open('http://10.0.0.2/roundcube/?_task=login', { method: 'POST', form: [['_user', 'ana'], ['_pass', 'ana1']] })), /Error de conexión con el servidor de almacenamiento \(IMAP\)/);
});

test('own port mode: Roundcube on :8080, Apache keeps the alias free; generated Apache snippet', () => {
  const { srv, pc, web } = lab('port');
  assert.match(body(web.open('http://webmail.aula.lab:8080/')), /Bienvenido a Roundcube/);
  assert.match(body(web.open('http://webmail.aula.lab/roundcube/')), /Not Found/);
  const conf = createShell(srv, 'linux', 'root').run('cat /etc/apache2/conf-enabled/roundcube.conf').join('\n');
  assert.match(conf, /^Listen 8080$/m);
  assert.match(createShell(srv, 'linux', 'root').run('ss -tln').join('\n'), /0\.0\.0\.0:8080/);
  assert.match(createShell(pc, 'linux').run('curl -s http://webmail.aula.lab:8080/ | grep --color=never -o "Roundcube Webmail ::[^<]*"').join(''), /Bienvenido/);
  srv.setUnit('http', false);
  assert.equal(new BrowserEngine(pc).open('http://webmail.aula.lab:8080/').kind, 'error', 'Roundcube needs Apache');
});

test('alias/port validation and browser origins', () => {
  assert.equal(validateAccess({ enabled: true, mode: 'alias', alias: '/correo', port: 8080 }), null);
  assert.match(validateAccess({ enabled: true, mode: 'alias', alias: 'correo', port: 8080 }) ?? '', /empezar por \//);
  assert.match(validateAccess({ enabled: true, mode: 'port', alias: '/x', port: 25 }) ?? '', /lo usa otro servicio/);
  assert.equal(originOf('http://WWW.Aula.lab/x'), 'www.aula.lab:80');
  assert.equal(originOf('www.aula.lab:8080/x?y'), 'www.aula.lab:8080');
});
