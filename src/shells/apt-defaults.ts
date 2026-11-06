/**
 * The configuration files a package ships, written when apt installs it on a host without service panels (a PC):
 * Kea's kea-dhcp4.conf (the basic one of the Ubuntu package, shortened), bind9's /etc/bind and nftables'
 * /etc/nftables.conf. On a Server or a GNU/Linux router these files come from its Servicios settings instead
 * (linux-files.ts), except samba's smb.conf, which has no settings box and is written on any host.
 */
import { bindFiles } from '../services/bind-files.ts';
import { defaultServices } from '../services/config.ts';
import { DEFAULT_SMB_CONF, SMB_CONF } from '../services/smb-conf.ts';
import { DEFAULT_NFTABLES_CONF, NFTABLES_CONF } from '../devices/server-firewall.ts';

export const KEA_DHCP4_CONF = '/etc/kea/kea-dhcp4.conf';

const KEA_DEFAULT = `// This is a basic configuration for the Kea DHCPv4 server. Subnet declarations
// are mostly commented out and no interfaces are listed. Therefore, the servers
// will not listen or respond to any queries.
// The basic configuration must be extended to specify interfaces on which
// the servers should listen. Make sure you at least update the following,
// before running this example in your network:
// - change the network interface names
// - change the subnets to match your network
// - change the option values to match your network
{
"Dhcp4": {
    // Add names of your network interfaces to listen on.
    "interfaces-config": {
        "interfaces": [ ]
    },

    "control-socket": {
        "socket-type": "unix",
        "socket-name": "kea4-ctrl-socket"
    },

    // Use Memfile lease database backend to store leases in a CSV file.
    "lease-database": {
        "type": "memfile",
        "lfc-interval": 3600
    },

    // Global timers specified here apply to all subnets, unless there are
    // subnet specific values defined in particular subnets.
    "renew-timer": 900,
    "rebind-timer": 1800,
    "valid-lifetime": 3600,

    "option-data": [
        {
            "name": "domain-name-servers",
            "data": "192.0.2.1, 192.0.2.2"
        },
        {
            "name": "domain-search",
            "data": "mydomain.example.com, example.com"
        }
    ],

    "subnet4": [
        {
            // This defines the whole subnet. Kea will use this information to
            // determine where the clients are connected.
            "id": 1,
            "subnet": "192.0.2.0/24",

            // Pools define the actual part of your subnet that is governed
            // by Kea.
            "pools": [ { "pool": "192.0.2.1 - 192.0.2.200" } ],

            "option-data": [
                {
                    // For each IPv4 subnet you most likely need to specify at
                    // least one router.
                    "name": "routers",
                    "data": "192.0.2.1"
                }
            ],

            "reservations": [
                {
                    "hw-address": "1a:1b:1c:1d:1e:1f",
                    "ip-address": "192.0.2.201"
                }
            ]
        }
    ],

    "loggers": [
    {
        "name": "kea-dhcp4",
        "output-options": [
            {
                "output": "stdout"
            }
        ],
        "severity": "INFO",
        "debuglevel": 0
    }
  ]
}
}
`;

const KEA_PACKAGES: ReadonlySet<string> = new Set(['kea', 'kea-dhcp4-server', 'isc-kea']);

/**
 * smb.conf is samba-common's conffile: the packages of the catalogue that bring it write it, on any host (no Servicios
 * settings write it).
 */
export const SMB_CONF_PACKAGES: ReadonlySet<string> = new Set(['samba', 'smbclient', 'samba-common-bin', 'winbind']);

/** The files a package ships, by path. */
export function shippedFiles(name: string): ReadonlyMap<string, string> {
  if (KEA_PACKAGES.has(name)) return new Map([[KEA_DHCP4_CONF, KEA_DEFAULT]]);
  if (name === 'bind9') return bindFiles(defaultServices().dns, []);
  if (SMB_CONF_PACKAGES.has(name)) return new Map([[SMB_CONF, DEFAULT_SMB_CONF]]);
  if (name === 'nftables') return new Map([[NFTABLES_CONF, DEFAULT_NFTABLES_CONF]]);
  return new Map();
}
