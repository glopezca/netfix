/** Directives Apache accepts (with the module that provides them) and their argument checks. */

const CORE = ['acceptfilter', 'acceptpathinfo', 'accessfilename', 'adddefaultcharset', 'allowencodedslashes', 'allowoverride', 'allowoverridelist', 'defaultruntimedir', 'define', 'documentroot', 'enablemmap', 'enablesendfile', 'error', 'errordocument', 'errorlog', 'errorlogformat', 'fileetag', 'hostnamelookups', 'include', 'includeoptional', 'keepalive', 'keepalivetimeout', 'limitrequestbody', 'limitrequestfields', 'limitrequestline', 'loglevel', 'maxkeepaliverequests', 'mutex', 'options', 'protocols', 'serveradmin', 'serveralias', 'servername', 'serverroot', 'serversignature', 'servertokens', 'sethandler', 'setinputfilter', 'setoutputfilter', 'timeout', 'traceenable', 'usecanonicalname', 'pidfile', 'user', 'group', 'listen', 'listenbacklog', 'startservers', 'minsparethreads', 'maxsparethreads', 'threadlimit', 'threadsperchild', 'maxrequestworkers', 'maxconnectionsperchild', 'serverlimit', 'minspareservers', 'maxspareservers', 'maxclients', 'loadmodule', 'loadfile', 'customlog', 'logformat', 'transferlog', 'extendedstatus', 'undefine', 'contentdigest', 'forcetype', 'limitxmlrequestbody', 'scoreboardfile'];

const BY_MODULE: Readonly<Record<string, readonly string[]>> = {
  alias: ['alias', 'aliasmatch', 'redirect', 'redirectmatch', 'redirectpermanent', 'redirecttemp', 'scriptalias', 'scriptaliasmatch'],
  dir: ['directoryindex', 'directoryslash', 'fallbackresource', 'directorycheckhandler', 'directoryindexredirect'],
  autoindex: ['indexoptions', 'indexignore', 'indexorderdefault', 'indexstylesheet', 'indexheadinsert', 'headername', 'readmename', 'adddescription', 'addicon', 'addiconbytype', 'addiconbyencoding', 'addalt', 'addaltbytype', 'addaltbyencoding', 'defaulticon', 'indexignorereset'],
  mime: ['addtype', 'addencoding', 'addlanguage', 'addcharset', 'addhandler', 'addoutputfilter', 'addinputfilter', 'typesconfig', 'removetype', 'removehandler', 'defaultlanguage', 'multiviewsmatch', 'modmimeusepathinfo'],
  authz_core: ['require', 'authmerging', 'authzsendforbiddenonfailure'],
  access_compat: ['order', 'allow', 'deny', 'satisfy'],
  auth_basic: ['authbasicprovider', 'authbasicauthoritative', 'authbasicfake', 'authbasicusedigestalgorithm'],
  authn_core: ['authtype', 'authname', 'authnprovideralias'],
  authn_file: ['authuserfile'],
  authz_user: [], authz_host: [],
  setenvif: ['setenvif', 'setenvifnocase', 'browsermatch', 'browsermatchnocase', 'setenvifexpr'],
  env: ['setenv', 'unsetenv', 'passenv'],
  reqtimeout: ['requestreadtimeout'],
  negotiation: ['languagepriority', 'forcelanguagepriority', 'cachenegotiateddocs'],
  deflate: ['deflatecompressionlevel', 'deflatebuffersize', 'deflatememlevel', 'deflatewindowsize', 'deflatefilternote'],
  filter: ['addoutputfilterbytype', 'filterchain', 'filterdeclare', 'filterprovider', 'filterprotocol', 'filtertrace'],
  status: ['seerequesttail'],
  rewrite: ['rewriteengine', 'rewriterule', 'rewritecond', 'rewritebase', 'rewritemap', 'rewriteoptions'],
  ssl: ['sslengine', 'sslcertificatefile', 'sslcertificatekeyfile', 'sslcertificatechainfile', 'sslcacertificatefile', 'sslprotocol', 'sslciphersuite', 'sslhonorcipherorder', 'sslrandomseed', 'sslsessioncache', 'sslsessioncachetimeout', 'sslpassphrasedialog', 'sslstapling', 'sslcompression', 'sslverifyclient', 'ssloptions'],
  headers: ['header', 'requestheader'],
  userdir: ['userdir'],
  proxy: ['proxypass', 'proxypassreverse', 'proxypreservehost', 'proxyrequests', 'proxypassmatch', 'proxytimeout', 'proxyset', 'proxyvia'],
  expires: ['expiresactive', 'expiresbytype', 'expiresdefault'],
  info: ['addmoduleinfo'],
  cgi: ['scriptlog', 'scriptlogbuffer', 'scriptloglength'],
  http2: [], remoteip: ['remoteipheader', 'remoteiptrustedproxy', 'remoteipinternalproxy'],
  socache_shmcb: [], vhost_alias: ['virtualdocumentroot', 'virtualscriptalias'], include: ['xbithack', 'ssiendtag', 'ssistarttag'],
};

const MODULE_OF = new Map<string, string>([...CORE.map((d) => [d, 'core'] as const), ...Object.entries(BY_MODULE).flatMap(([m, list]) => list.map((d) => [d, m] as const))]);

/** Module that provides a directive (lower case), or undefined when Apache does not know it. */
export function directiveModule(name: string): string | undefined {
  return MODULE_OF.get(name);
}

const ARGS: Readonly<Record<string, readonly [number, number, string]>> = {
  documentroot: [1, 1, 'DocumentRoot takes one argument, Root directory of the document tree'],
  servername: [1, 1, 'ServerName takes one argument, The hostname and port of the server'],
  listen: [1, 2, 'Listen requires at least one argument'],
  alias: [2, 2, 'Alias takes two arguments, a fakename and a realname'],
  redirect: [2, 3, 'Redirect takes one, two or three arguments, an optional status, then document to be redirected and destination URL'],
  errordocument: [2, 2, 'ErrorDocument takes two arguments, Change responses for HTTP errors'],
  loadmodule: [2, 2, 'LoadModule takes two arguments, a module name and the name of a shared object file to load it from'],
  include: [1, 1, 'Include takes one argument, Name(s) of the config file(s) to be included; fails if the wildcard does not match at least one file'],
  includeoptional: [1, 1, 'IncludeOptional takes one argument, Name or pattern of the config file(s) to be included; ignored if the file does not exist or the pattern does not match any files'],
  serveradmin: [1, 1, 'ServerAdmin takes one argument, The email address of the server administrator'],
  directoryindex: [1, 99, 'DirectoryIndex requires at least one argument'],
  serveralias: [1, 99, 'ServerAlias requires at least one argument, a name or names alias to this host'],
};

export function argError(name: string, args: readonly string[]): string | null {
  const spec = ARGS[name];
  if (!spec) return null;
  return args.length < spec[0] || args.length > spec[1] ? spec[2] : null;
}
