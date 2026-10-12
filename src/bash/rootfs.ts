/** Ubuntu 26.04 root file system skeleton (directories, /etc, /dev, /proc, /usr/bin and home directories). */
import type { Vfs } from './vfs.ts';
import { ROOT } from './vfs.ts';
import type { UserInfo } from './types.ts';
import { BINARY_MARK } from './path.ts';

export const BASHRC = `# ~/.bashrc: executed by bash(1) for non-login shells.
# see /usr/share/doc/bash/examples/startup-files (in the package bash-doc)

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

# don't put duplicate lines or lines starting with space in the history.
HISTCONTROL=ignoreboth

# append to the history file, don't overwrite it
shopt -s histappend

# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)
HISTSIZE=1000
HISTFILESIZE=2000

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

PS1='\${debian_chroot:+(\$debian_chroot)}\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '

# enable color support of ls and also add handy aliases
alias ls='ls --color=auto'
alias grep='grep --color=auto'
alias fgrep='fgrep --color=auto'
alias egrep='egrep --color=auto'

# some more ls aliases
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

# Alias definitions.
if [ -f ~/.bash_aliases ]; then
    . ~/.bash_aliases
fi
`;

const ROOT_BASHRC = `# ~/.bashrc: executed by bash(1) for non-login shells.
case $- in
    *i*) ;;
      *) return;;
esac
HISTCONTROL=ignoreboth
PS1='\${debian_chroot:+(\$debian_chroot)}\\u@\\h:\\w\\$ '
alias ls='ls --color=auto'
alias grep='grep --color=auto'
alias ll='ls -alF'
`;

const BASH_BASHRC = `# System-wide .bashrc file for interactive bash(1) shells.
[ -z "$PS1" ] && return
shopt -s checkwinsize

# if the command-not-found package is installed, use it
if [ -x /usr/lib/command-not-found ]; then
	function command_not_found_handle {
		if [ -x /usr/lib/command-not-found ]; then
			/usr/lib/command-not-found -- "$1"
			return $?
		else
			printf "%s: command not found\\n" "$1" >&2
			return 127
		fi
	}
fi
`;

const PROFILE = `# ~/.profile: executed by the command interpreter for login shells.
if [ -n "$BASH_VERSION" ]; then
    # include .bashrc if it exists
    if [ -f "$HOME/.bashrc" ]; then
	. "$HOME/.bashrc"
    fi
fi

# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/bin" ] ; then
    PATH="$HOME/bin:$PATH"
fi
`;

const SERVICES = ['ftp-data\t20/tcp', 'ftp\t\t21/tcp', 'ssh\t\t22/tcp', 'telnet\t\t23/tcp', 'smtp\t\t25/tcp\t\tmail', 'domain\t\t53/tcp', 'domain\t\t53/udp',
  'bootps\t\t67/udp', 'bootpc\t\t68/udp', 'tftp\t\t69/udp', 'http\t\t80/tcp\t\twww', 'pop3\t\t110/tcp\t\tpop-3', 'ntp\t\t123/udp', 'imap2\t\t143/tcp\t\timap',
  'snmp\t\t161/udp', 'ldap\t\t389/tcp', 'https\t\t443/tcp', 'submissions\t465/tcp\t\tssmtp smtps', 'submission\t587/tcp', 'imaps\t\t993/tcp', 'pop3s\t\t995/tcp'].join('\n');

export interface RootfsOptions {
  readonly hostname: string;
  readonly users: readonly UserInfo[];
  readonly programs: readonly string[];
}

function seedDirs(fs: Vfs): void {
  for (const d of ['/boot', '/dev', '/etc', '/home', '/media', '/mnt', '/opt', '/proc', '/run', '/srv', '/sys', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/local/bin', '/usr/share/doc',
    '/var/log', '/var/lib', '/var/cache', '/var/mail', '/var/spool', '/var/tmp', '/etc/skel', '/etc/default', '/etc/network', '/etc/ssh', '/var/www']) fs.seed(d, { kind: 'dir' });
  fs.seed('/root', { kind: 'dir' }, 0o700);
  fs.seed('/tmp', { kind: 'dir' }, 0o1777);
  fs.seed('/var/tmp', { kind: 'dir' }, 0o1777);
  for (const [l, t] of [['/bin', 'usr/bin'], ['/sbin', 'usr/sbin'], ['/lib', 'usr/lib'], ['/lib64', 'usr/lib64']]) fs.seed(l ?? '', { kind: 'link', target: t ?? '' });
  for (const d of ['null', 'zero', 'tty', 'random', 'urandom', 'console', 'stdin', 'stdout', 'stderr']) fs.seed(`/dev/${d}`, { kind: 'dev', dev: d }, 0o666);
  fs.seed('/dev/fd', { kind: 'dir' }, 0o777);
}

function seedEtc(fs: Vfs, o: RootfsOptions): void {
  const shadowGid = 42;
  fs.seed('/etc/shells', { kind: 'file', content: '# /etc/shells: valid login shells\n/bin/sh\n/usr/bin/sh\n/bin/bash\n/usr/bin/bash\n/bin/rbash\n/usr/bin/rbash\n/usr/bin/dash\n' });
  fs.seed('/etc/issue', { kind: 'file', content: 'Ubuntu 26.04 LTS \\n \\l\n\n' });
  fs.seed('/etc/timezone', { kind: 'file', content: 'Etc/UTC\n' });
  fs.seed('/etc/services', { kind: 'file', content: `${SERVICES}\n` });
  fs.seed('/etc/bash.bashrc', { kind: 'file', content: BASH_BASHRC });
  fs.seed('/etc/profile', { kind: 'file', content: '# /etc/profile: system-wide .profile file for the Bourne shell.\nif [ "${PS1-}" ]; then\n  if [ "${BASH-}" ] && [ "$BASH" != "/bin/sh" ]; then\n    if [ -f /etc/bash.bashrc ]; then\n      . /etc/bash.bashrc\n    fi\n  fi\nfi\n' });
  fs.seed('/etc/fstab', { kind: 'file', content: '# <file system> <mount point>   <type>  <options>       <dump>  <pass>\n/dev/sda1       /               ext4    errors=remount-ro 0       1\n' });
  fs.seed('/etc/shadow', { kind: 'file', content: o.users.map((u) => `${u.name}:${u.uid === 0 ? '*' : '$y$j9T$netfix$'}:20372:0:99999:7:::`).join('\n') + '\n' }, 0o640, 0, shadowGid);
  fs.seed('/etc/skel/.bashrc', { kind: 'file', content: BASHRC });
  fs.seed('/etc/skel/.profile', { kind: 'file', content: PROFILE });
  fs.seed('/etc/motd', { kind: 'file', content: '' });
  fs.seed('/proc/version', { kind: 'file', content: 'Linux version 6.17.0-14-generic (buildd@lcy02-amd64-001) (x86_64-linux-gnu-gcc-15 (Ubuntu 15.2.0-4ubuntu4) 15.2.0) #14-Ubuntu SMP PREEMPT_DYNAMIC Fri Sep 25 10:12:03 UTC 2026\n' });
  fs.seed('/proc/cpuinfo', { kind: 'file', content: 'processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: Netfix virtual CPU\ncpu MHz\t\t: 2400.000\ncpu cores\t: 2\n\nprocessor\t: 1\nvendor_id\t: GenuineIntel\nmodel name\t: Netfix virtual CPU\ncpu MHz\t\t: 2400.000\ncpu cores\t: 2\n' });
  fs.seed('/proc/meminfo', { kind: 'file', content: 'MemTotal:        4014820 kB\nMemFree:         2531108 kB\nMemAvailable:    3202476 kB\n' });
  fs.seed('/proc/loadavg', { kind: 'file', content: '0.00 0.01 0.00 1/123 4321\n' });
}

/** The account files and home directories of the given users. */
export function seedUsers(fs: Vfs, users: readonly UserInfo[]): void {
  const groups = new Map<number, string>([[0, 'root'], [4, 'adm'], [27, 'sudo'], [33, 'www-data'], [42, 'shadow'], [100, 'users']]);
  for (const u of users) if (!groups.has(u.gid)) groups.set(u.gid, u.name);
  const members = (gid: number): string => users.filter((u) => u.uid !== 0 && u.groups.includes(gid) && u.gid !== gid).map((u) => u.name).join(',');
  fs.seed('/etc/passwd', { kind: 'file', content: [...users.map((u) => `${u.name}:x:${u.uid}:${u.gid}:${u.uid === 0 ? 'root' : u.name}:${u.home}:${u.shell}`), 'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin', 'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin'].join('\n') + '\n' });
  fs.seed('/etc/group', { kind: 'file', content: [...groups].sort((a, b) => a[0] - b[0]).map(([gid, name]) => `${name}:x:${gid}:${members(gid)}`).join('\n') + '\n' });
  for (const u of users) {
    if (!fs.exists(u.home)) fs.seed(u.home, { kind: 'dir' }, u.uid === 0 ? 0o700 : 0o750, u.uid, u.gid);
    const files: [string, string][] = [['.bashrc', u.uid === 0 ? ROOT_BASHRC : BASHRC], ['.profile', PROFILE]];
    if (u.uid !== 0) files.push(['.bash_logout', '# ~/.bash_logout: executed by bash(1) when login shell exits.\n']);
    for (const [name, content] of files) if (!fs.exists(`${u.home}/${name}`)) fs.seed(`${u.home}/${name}`, { kind: 'file', content }, 0o644, u.uid, u.gid);
  }
}

export function seedRootfs(fs: Vfs, o: RootfsOptions): void {
  seedDirs(fs);
  seedEtc(fs, o);
  seedUsers(fs, o.users);
  for (const p of o.programs) {
    const dir = /^(systemctl|dhclient|ip|ss|sshd|service|useradd)$/.test(p) ? '/usr/sbin' : '/usr/bin';
    fs.seed(`${dir}/${p}`, { kind: 'file', content: `${BINARY_MARK}${p}\n` }, 0o755);
  }
  fs.seed('/usr/bin/vi', { kind: 'link', target: 'vim' });
  fs.seed('/usr/bin/sh', { kind: 'link', target: 'dash' });
  fs.seed('/usr/bin/dash', { kind: 'file', content: `${BINARY_MARK}bash\n` }, 0o755);
  fs.mkdir('/usr/bin', ROOT, true);
}
