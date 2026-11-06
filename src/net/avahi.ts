/**
 * What avahi-daemon read from /etc/avahi/avahi-daemon.conf when it last started (shells/link-services.ts parses it):
 * the name it publishes (`host-name=`, the host name when absent) and whether it publishes at all
 * (`disable-publishing=yes` turns it off). Kept beside the host in a weak registry, as systemd-resolved's settings.
 */
export interface AvahiConfig {
  /** Empty: the host name. */
  readonly hostName: string;
  readonly publish: boolean;
}

export const AVAHI_DEFAULT: AvahiConfig = { hostName: '', publish: true };

const configs = new WeakMap<object, AvahiConfig>();

export function setAvahiConfig(host: object, c: AvahiConfig): void {
  configs.set(host, c);
}

export function avahiConfig(host: object): AvahiConfig {
  return configs.get(host) ?? AVAHI_DEFAULT;
}
