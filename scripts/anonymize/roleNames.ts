// Icon filenames observed in the running app's device inventory map to a
// short role token used to build realistic fake hostnames. `device` is the
// fallback for any icon not in this table.
const ROLE_BY_ICON: Record<string, string> = {
  "cisco.svg": "sw",
  "opnsense.svg": "fw",
  "pfsense.svg": "fw",
  "synology.svg": "nas",
  "tplink.svg": "ap",
  "linksys.png": "ap",
  "proxmox.svg": "hv",
  "ubuntu.svg": "srv",
  "debian.svg": "srv",
  "arch.svg": "srv",
  "raspbian.svg": "srv",
  "openwrt.svg": "rtr",
  "brother.svg": "printer",
};

export function roleFromIcon(icon: string): string {
  return ROLE_BY_ICON[icon] ?? "device";
}

export const SITE_NAME_POOL = [
  "HQ",
  "Branch-East",
  "Branch-West",
  "Datacenter-1",
  "Datacenter-2",
  "Branch-North",
  "Branch-South",
  "Datacenter-3",
];

export function siteIdFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
