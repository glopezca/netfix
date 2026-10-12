/** /etc/apache2 as installed by Ubuntu's apache2 package (comments shortened). */

export const APACHE_ROOT = '/etc/apache2';

export const ENVVARS: Readonly<Record<string, string>> = {
  APACHE_RUN_USER: 'www-data', APACHE_RUN_GROUP: 'www-data', APACHE_PID_FILE: '/var/run/apache2/apache2.pid',
  APACHE_RUN_DIR: '/var/run/apache2', APACHE_LOCK_DIR: '/var/lock/apache2', APACHE_LOG_DIR: '/var/log/apache2',
};

const APACHE2_CONF = `# This is the main Apache server configuration file.  It contains the
# configuration directives that give the server its instructions.
# See http://httpd.apache.org/docs/2.4/ for detailed information about
# the directives and /usr/share/doc/apache2/README.Debian about Debian specific
# hints.
#
# Summary of how the Apache 2 configuration works in Debian:
#
#	/etc/apache2/
#	|-- apache2.conf
#	|	\`--  ports.conf
#	|-- mods-enabled
#	|	|-- *.load
#	|	\`-- *.conf
#	|-- conf-enabled
#	|	\`-- *.conf
#	\`-- sites-enabled
#		\`-- *.conf
#
# Use a2enmod/a2dismod, a2ensite/a2dissite and a2enconf/a2disconf to enable
# and disable modules, sites and configuration snippets.

DefaultRuntimeDir \${APACHE_RUN_DIR}
PidFile \${APACHE_PID_FILE}
Timeout 300
KeepAlive On
MaxKeepAliveRequests 100
KeepAliveTimeout 5

User \${APACHE_RUN_USER}
Group \${APACHE_RUN_GROUP}

HostnameLookups Off
ErrorLog \${APACHE_LOG_DIR}/error.log
LogLevel warn

# Include module configuration:
IncludeOptional mods-enabled/*.load
IncludeOptional mods-enabled/*.conf

# Include list of ports to listen on
Include ports.conf

# Sets the default security model of the Apache2 HTTPD server. It does
# not allow access to the root filesystem outside of /usr/share and /var/www.
<Directory />
	Options FollowSymLinks
	AllowOverride None
	Require all denied
</Directory>

<Directory /usr/share>
	AllowOverride None
	Require all granted
</Directory>

<Directory /var/www/>
	Options Indexes FollowSymLinks
	AllowOverride None
	Require all granted
</Directory>

AccessFileName .htaccess

<FilesMatch "^\\.ht">
	Require all denied
</FilesMatch>

LogFormat "%v:%p %h %l %u %t \\"%r\\" %>s %O \\"%{Referer}i\\" \\"%{User-Agent}i\\"" vhost_combined
LogFormat "%h %l %u %t \\"%r\\" %>s %O \\"%{Referer}i\\" \\"%{User-Agent}i\\"" combined
LogFormat "%h %l %u %t \\"%r\\" %>s %O" common

# Include generic snippets of statements
IncludeOptional conf-enabled/*.conf

# Include the virtual host configurations:
IncludeOptional sites-enabled/*.conf
`;

const PORTS_CONF = `# If you just change the port or add more ports here, you will likely also
# have to change the VirtualHost statement in
# /etc/apache2/sites-enabled/000-default.conf

Listen 80

<IfModule ssl_module>
	Listen 443
</IfModule>

<IfModule mod_gnutls.c>
	Listen 443
</IfModule>
`;

const DEFAULT_SITE = `<VirtualHost *:80>
	# The ServerName directive sets the request scheme, hostname and port that
	# the server uses to identify itself. This is used when creating
	# redirection URLs. In the context of virtual hosts, the ServerName
	# specifies what hostname must appear in the request's Host: header to
	# match this virtual host. For the default virtual host (this file) this
	# value is not decisive as it is used as a last resort host regardless.
	#ServerName www.example.com

	ServerAdmin webmaster@localhost
	DocumentRoot /var/www/html

	ErrorLog \${APACHE_LOG_DIR}/error.log
	CustomLog \${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
`;

const DEFAULT_SSL = `<VirtualHost *:443>
	ServerAdmin webmaster@localhost
	DocumentRoot /var/www/html

	ErrorLog \${APACHE_LOG_DIR}/error.log
	CustomLog \${APACHE_LOG_DIR}/access.log combined

	SSLEngine on
	SSLCertificateFile	/etc/ssl/certs/ssl-cert-snakeoil.pem
	SSLCertificateKeyFile /etc/ssl/private/ssl-cert-snakeoil.key
</VirtualHost>
`;

/** Modules shipped by the package; `true` = enabled after installation. */
export const MODULES: Readonly<Record<string, boolean>> = {
  access_compat: true, alias: true, auth_basic: true, authn_core: true, authn_file: true, authz_core: true, authz_host: true, authz_user: true,
  autoindex: true, deflate: true, dir: true, env: true, filter: true, mime: true, mpm_event: true, negotiation: true, reqtimeout: true,
  setenvif: true, status: true, rewrite: false, ssl: false, headers: false, userdir: false, proxy: false, proxy_http: false, cgi: false,
  expires: false, include: false, info: false, socache_shmcb: false, http2: false, remoteip: false, vhost_alias: false, auth_digest: false,
};

/** a2enmod also enables these. */
export const MODULE_DEPS: Readonly<Record<string, readonly string[]>> = {
  ssl: ['setenvif', 'mime', 'socache_shmcb'], proxy_http: ['proxy'], userdir: [], auth_basic: ['authn_core'],
};

const MOD_CONF: Readonly<Record<string, string>> = {
  alias: '<IfModule alias_module>\n\tAlias /icons/ "/usr/share/apache2/icons/"\n\n\t<Directory "/usr/share/apache2/icons">\n\t\tOptions FollowSymlinks\n\t\tAllowOverride None\n\t\tRequire all granted\n\t</Directory>\n</IfModule>\n',
  dir: '<IfModule mod_dir.c>\n\tDirectoryIndex index.html index.cgi index.pl index.php index.xhtml index.htm\n</IfModule>\n',
  autoindex: '<IfModule mod_autoindex.c>\n\tIndexOptions FancyIndexing VersionSort HTMLTable NameWidth=* DescriptionWidth=* Charset=UTF-8\n\tIndexIgnore .??* *~ *# RCS CVS *,v *,t\n</IfModule>\n',
  mime: '<IfModule mod_mime.c>\n\tTypesConfig /etc/mime.types\n\tAddType application/x-compress .Z\n\tAddType application/x-gzip .gz .tgz\n\tAddCharset UTF-8 .utf8\n</IfModule>\n',
  status: '<IfModule mod_status.c>\n\t<Location /server-status>\n\t\tSetHandler server-status\n\t\tRequire local\n\t</Location>\n\tExtendedStatus On\n</IfModule>\n',
  mpm_event: '<IfModule mpm_event_module>\n\tStartServers\t\t\t 2\n\tMinSpareThreads\t\t 25\n\tMaxSpareThreads\t\t 75\n\tThreadLimit\t\t\t 64\n\tThreadsPerChild\t\t 25\n\tMaxRequestWorkers\t  150\n\tMaxConnectionsPerChild   0\n</IfModule>\n',
  reqtimeout: '<IfModule reqtimeout_module>\n\tRequestReadTimeout header=20-40,minrate=500\n\tRequestReadTimeout body=10,minrate=500\n</IfModule>\n',
  setenvif: '<IfModule mod_setenvif.c>\n\tBrowserMatch "Mozilla/2" nokeepalive\n</IfModule>\n',
  negotiation: '<IfModule mod_negotiation.c>\n\tLanguagePriority en ca cs da de el eo es et fr he hr it ja ko ltz nl nn no pl pt pt-BR ru sv tr zh-CN zh-TW\n\tForceLanguagePriority Prefer Fallback\n</IfModule>\n',
  deflate: '<IfModule mod_deflate.c>\n\t<IfModule mod_filter.c>\n\t\tAddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript\n\t</IfModule>\n</IfModule>\n',
  userdir: '<IfModule mod_userdir.c>\n\tUserDir public_html\n\tUserDir disabled root\n\n\t<Directory /home/*/public_html>\n\t\tAllowOverride FileInfo AuthConfig Limit Indexes\n\t\tOptions MultiViews Indexes SymLinksIfOwnerMatch IncludesNoExec\n\t\tRequire all granted\n\t</Directory>\n</IfModule>\n',
  ssl: '<IfModule mod_ssl.c>\n\tSSLRandomSeed startup builtin\n\tSSLRandomSeed connect builtin\n\tSSLProtocol all -SSLv3\n</IfModule>\n',
  info: '<IfModule mod_info.c>\n\t<Location /server-info>\n\t\tSetHandler server-info\n\t\tRequire local\n\t</Location>\n</IfModule>\n',
};

const CONFS: Readonly<Record<string, string>> = {
  charset: '# Read the documentation before enabling AddDefaultCharset.\n#AddDefaultCharset UTF-8\n',
  'localized-error-pages': '# Customizable error responses come in three flavors:\n#ErrorDocument 404 /missing.html\n',
  'other-vhosts-access-log': '# Define an access log for VirtualHosts that don\'t define their own logfile\nCustomLog ${APACHE_LOG_DIR}/other_vhosts_access.log vhost_combined\n',
  security: '# Changing the following options will not really affect the security of the\n# server, but might make attacks slightly more difficult in some cases.\nServerTokens OS\nServerSignature On\nTraceEnable Off\n',
  'serve-cgi-bin': '<IfModule mod_alias.c>\n\t<IfModule mod_cgi.c>\n\t\tDefine ENABLE_USR_LIB_CGI_BIN\n\t</IfModule>\n</IfModule>\n',
};

export interface SeedTarget {
  seed(path: string, node: { kind: 'file'; content: string } | { kind: 'dir' } | { kind: 'link'; target: string }, mode?: number): void;
}

/** Writes the package files (not marked as user changes, so they are not saved with the topology). */
export function seedApache(fs: SeedTarget): void {
  const R = APACHE_ROOT;
  for (const d of ['', '/sites-available', '/sites-enabled', '/mods-available', '/mods-enabled', '/conf-available', '/conf-enabled']) fs.seed(`${R}${d}`, { kind: 'dir' }, 0o755);
  fs.seed(`${R}/apache2.conf`, { kind: 'file', content: APACHE2_CONF });
  fs.seed(`${R}/ports.conf`, { kind: 'file', content: PORTS_CONF });
  fs.seed(`${R}/envvars`, { kind: 'file', content: Object.entries(ENVVARS).map(([k, v]) => `export ${k}=${v}`).join('\n') + '\n' });
  fs.seed(`${R}/sites-available/000-default.conf`, { kind: 'file', content: DEFAULT_SITE });
  fs.seed(`${R}/sites-available/default-ssl.conf`, { kind: 'file', content: DEFAULT_SSL });
  fs.seed(`${R}/sites-enabled/000-default.conf`, { kind: 'link', target: '../sites-available/000-default.conf' });
  for (const [mod, on] of Object.entries(MODULES)) {
    fs.seed(`${R}/mods-available/${mod}.load`, { kind: 'file', content: `LoadModule ${mod}_module /usr/lib/apache2/modules/mod_${mod}.so\n` });
    if (MOD_CONF[mod]) fs.seed(`${R}/mods-available/${mod}.conf`, { kind: 'file', content: MOD_CONF[mod] ?? '' });
    if (!on) continue;
    fs.seed(`${R}/mods-enabled/${mod}.load`, { kind: 'link', target: `../mods-available/${mod}.load` });
    if (MOD_CONF[mod]) fs.seed(`${R}/mods-enabled/${mod}.conf`, { kind: 'link', target: `../mods-available/${mod}.conf` });
  }
  for (const [name, content] of Object.entries(CONFS)) {
    fs.seed(`${R}/conf-available/${name}.conf`, { kind: 'file', content });
    fs.seed(`${R}/conf-enabled/${name}.conf`, { kind: 'link', target: `../conf-available/${name}.conf` });
  }
  for (const d of ['/var/log/apache2', '/usr/share/apache2', '/usr/share/apache2/icons', '/var/lib/apache2']) fs.seed(d, { kind: 'dir' }, 0o755);
}
