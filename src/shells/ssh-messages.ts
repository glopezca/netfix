/** OpenSSH client warnings, word for word. */

const BAR = '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@';

export function hostKeyChanged(type: string, fp: string, knownHosts: string, line: number, target: string): string[] {
  return [
    BAR,
    '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
    BAR,
    'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!',
    'Someone could be eavesdropping on you right now (man-in-the-middle attack)!',
    'It is also possible that a host key has just been changed.',
    `The fingerprint for the ${type} key sent by the remote host is`,
    `${fp}.`,
    'Please contact your system administrator.',
    `Add correct host key in ${knownHosts} to get rid of this message.`,
    `Offending ${type} key in ${knownHosts}:${line}`,
    '  remove with:',
    `  ssh-keygen -f '${knownHosts}' -R '${target}'`,
    `Host key for ${target} has changed and you have requested strict checking.`,
    'Host key verification failed.',
  ];
}

export function unprotectedKey(mode: number, path: string): string[] {
  return [
    BAR,
    '@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @',
    BAR,
    `Permissions 0${(mode & 0o777).toString(8)} for '${path}' are too open.`,
    'It is required that your private key files are NOT accessible by others.',
    'This private key will be ignored.',
    `Load key "${path}": bad permissions`,
  ];
}

/** StrictHostKeyChecking=no with a changed key: OpenSSH connects, but never sends a password. */
export function mitmPasswordDisabled(): string[] {
  return [
    'Password authentication is disabled to avoid man-in-the-middle attacks.',
    'Keyboard-interactive authentication is disabled to avoid man-in-the-middle attacks.',
  ];
}
