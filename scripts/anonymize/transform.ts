import type {
  TopologyResponse,
  DeviceOverview,
  Site,
  DeviceSummary,
  ArpDiscoveredDevice,
  OverlayLink as OverlayLinkT,
  SubnetGroup,
  NeighborLink,
  ArpLink,
  Alert,
  DeviceRoute,
  DeviceInterface,
} from "../../src/types";
import { createAnonymizer } from "./engine";
import { roleFromIcon, siteIdFromName, SITE_NAME_POOL } from "./roleNames";

export interface AnonymizeResult {
  topology: TopologyResponse;
  overviews: Record<string, DeviceOverview>;
}

function splitCidr(cidr: string): [string, string] {
  const [addr, prefix] = cidr.split("/");
  return [addr, prefix ?? "32"];
}

export function anonymizeTopology(
  raw: TopologyResponse,
  rawOverviews: Record<string, DeviceOverview>,
): AnonymizeResult {
  const eng = createAnonymizer();
  const hostnameMap = new Map<string, string>();
  const displayNameMap = new Map<string, string>();
  const siteIdMap = new Map<string, string>();
  const siteLocationMap = new Map<string, string>();
  const roleCounters: Record<string, number> = {};

  // Pass 1: one fake identity per managed device, keyed by both the real
  // hostname (an opaque join key everywhere else in the payload) and the
  // real displayName, so any field carrying either value resolves the same.
  for (const site of raw.sites) {
    for (const d of site.devices) {
      const role = roleFromIcon(d.icon);
      roleCounters[role] = (roleCounters[role] ?? 0) + 1;
      const fakeName = `${role}-${String(roleCounters[role]).padStart(2, "0")}.demo.lan`;
      hostnameMap.set(d.hostname, fakeName);
      displayNameMap.set(d.displayName, fakeName);
      eng.registerScrubEntry(d.hostname, fakeName);
      eng.registerScrubEntry(d.displayName, fakeName);
      if (d.sysName) eng.registerScrubEntry(d.sysName, fakeName);
    }
  }

  // Pass 2: fake site identities, assigned in the order sites appear.
  raw.sites.forEach((s, i) => {
    const fakeLocation = SITE_NAME_POOL[i] ?? `Site-${i + 1}`;
    const fakeId = siteIdFromName(fakeLocation);
    siteIdMap.set(s.id, fakeId);
    siteLocationMap.set(s.location, fakeLocation);
    eng.registerScrubEntry(s.id, fakeId);
    eng.registerScrubEntry(s.location, fakeLocation);
  });

  const fakeHostname = (h: string) => hostnameMap.get(h) ?? h;
  const fakeDisplay = (n: string) => displayNameMap.get(n) ?? n;
  const fakeSiteId = (id: string) => siteIdMap.get(id) ?? id;
  const fakeLocation = (loc: string) => siteLocationMap.get(loc) ?? loc;

  function anonRoute(r: DeviceRoute): DeviceRoute {
    return {
      dest: eng.ip(r.dest),
      prefix: r.prefix,
      nextHop: eng.ip(r.nextHop),
      nextHopDevice: r.nextHopDevice ? fakeDisplay(r.nextHopDevice) : r.nextHopDevice,
      iface: r.iface,
      protocol: r.protocol,
      type: r.type,
    };
  }

  function anonDeviceSummary(d: DeviceSummary): DeviceSummary {
    return {
      device_id: d.device_id,
      hostname: fakeHostname(d.hostname),
      displayName: fakeDisplay(d.displayName),
      ip: eng.ip(d.ip),
      lanIp: eng.ip(d.lanIp),
      ips: d.ips.map((x) => eng.ip(x)),
      allIps: d.allIps.map((x) => eng.ip(x)),
      macs: d.macs.map((x) => eng.mac(x)),
      os: d.os,
      icon: d.icon,
      status: d.status,
      uptime: d.uptime,
      location: fakeLocation(d.location),
      hardware: eng.scrub(d.hardware),
      sysName: eng.scrub(d.sysName),
      totalInRate: d.totalInRate,
      totalOutRate: d.totalOutRate,
      portCount: d.portCount,
      overlayPorts: d.overlayPorts.map((p) => ({ ...p, ip: eng.ip(p.ip) })),
      routes: d.routes?.map(anonRoute),
    };
  }

  function anonSite(s: Site): Site {
    return {
      id: fakeSiteId(s.id),
      location: fakeLocation(s.location),
      lat: null,
      lng: null,
      devices: s.devices.map(anonDeviceSummary),
    };
  }

  function anonOverlayLink(l: OverlayLinkT): OverlayLinkT {
    const [addr, prefix] = splitCidr(l.subnet);
    return {
      overlayType: l.overlayType,
      subnet: `${eng.ip(addr)}/${prefix}`,
      from: fakeHostname(l.from),
      to: fakeHostname(l.to),
      fromIp: eng.ip(l.fromIp),
      toIp: eng.ip(l.toIp),
      fromIface: l.fromIface,
      toIface: l.toIface,
    };
  }

  function anonSubnetGroup(g: SubnetGroup): SubnetGroup {
    const [addr, prefix] = splitCidr(g.subnet);
    return {
      overlayType: g.overlayType,
      subnet: `${eng.ip(addr)}/${prefix}`,
      color: g.color,
      label: eng.scrub(g.label),
      topology: g.topology,
      hub: g.hub ? fakeHostname(g.hub) : g.hub,
      links: g.links.map(anonOverlayLink),
    };
  }

  function anonNeighbor(n: NeighborLink): NeighborLink {
    return {
      id: n.id,
      localDeviceId: n.localDeviceId,
      localHostname: fakeHostname(n.localHostname),
      localPort: n.localPort,
      remoteDeviceId: n.remoteDeviceId,
      remoteHostname: fakeHostname(n.remoteHostname),
      remotePort: n.remotePort,
      protocol: n.protocol,
    };
  }

  function anonArpLink(l: ArpLink): ArpLink {
    return {
      fromHostname: fakeHostname(l.fromHostname),
      toHostname: fakeHostname(l.toHostname),
      fromIp: eng.ip(l.fromIp),
      toIp: eng.ip(l.toIp),
      mac: eng.mac(l.mac),
      fromInterface: l.fromInterface,
      fromMac: l.fromMac ? eng.mac(l.fromMac) : l.fromMac,
      toInterface: l.toInterface,
      toMac: l.toMac ? eng.mac(l.toMac) : l.toMac,
      sourceDown: l.sourceDown,
    };
  }

  function anonArpDevice(d: ArpDiscoveredDevice): ArpDiscoveredDevice {
    return {
      mac: eng.mac(d.mac),
      macs: d.macs.map((x) => eng.mac(x)),
      ips: d.ips.map((x) => eng.ip(x)),
      vendor: d.vendor,
      location: fakeLocation(d.location),
      siteId: fakeSiteId(d.siteId),
      seenByHostname: fakeHostname(d.seenByHostname),
      seenByInterface: d.seenByInterface,
      seenByIp: d.seenByIp ? eng.ip(d.seenByIp) : d.seenByIp,
      seenByMac: d.seenByMac ? eng.mac(d.seenByMac) : d.seenByMac,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      stale: d.stale,
      sourceDown: d.sourceDown,
    };
  }

  function anonAlert(a: Alert): Alert {
    return {
      id: a.id,
      device_id: a.device_id,
      hostname: fakeHostname(a.hostname),
      rule: eng.scrub(a.rule),
      severity: a.severity,
      state: a.state,
      timestamp: a.timestamp,
    };
  }

  function anonInterface(iface: DeviceInterface): DeviceInterface {
    return {
      ifName: iface.ifName,
      mac: eng.mac(iface.mac),
      vendor: iface.vendor,
      ifOperStatus: iface.ifOperStatus,
      ips: iface.ips.map((x) => eng.ip(x)),
    };
  }

  const topology: TopologyResponse = {
    sites: raw.sites.map(anonSite),
    overlays: raw.overlays.map(anonSubnetGroup),
    neighbors: raw.neighbors.map(anonNeighbor),
    arpLinks: raw.arpLinks.map(anonArpLink),
    arpDevices: raw.arpDevices.map(anonArpDevice),
    alerts: raw.alerts.map(anonAlert),
    lastUpdated: "2026-01-01T00:00:00.000Z",
  };

  const overviews: Record<string, DeviceOverview> = {};
  for (const [realHostname, ov] of Object.entries(rawOverviews)) {
    const fakeKey = fakeHostname(realHostname);
    overviews[fakeKey] = {
      device: {
        device_id: ov.device.device_id,
        hostname: fakeHostname(ov.device.hostname),
        displayName: fakeDisplay(ov.device.displayName),
        ip: eng.ip(ov.device.ip),
        ips: ov.device.ips.map((x) => eng.ip(x)),
        os: ov.device.os,
        version: ov.device.version,
        icon: ov.device.icon,
        status: ov.device.status,
        status_reason: eng.scrub(ov.device.status_reason),
        location: fakeLocation(ov.device.location),
        uptime: ov.device.uptime,
        sysName: eng.scrub(ov.device.sysName),
        hardware: eng.scrub(ov.device.hardware),
        // features is raw SNMP/OS-derived free text, same unregistered-text risk
        // class as the old sysDescr bug — currently unused by any UI component
        // (real or demo), so it's blanked rather than scrubbed.
        features: "",
        serial: ov.device.serial ? "DEMO-00000000" : "",
        sysContact: "",
        // sysDescr is free-form vendor/SNMP text that can embed an admin-chosen
        // hostname eng.scrub() has no registry entry for (e.g. a DSM kernel
        // banner reporting a NAS's real hostname). Synthesize a safe value from
        // already-anonymized fields instead of scrubbing the real string —
        // mirrors the UI's own fallback for an empty sysDescr (DevicePopover.tsx).
        sysDescr: [ov.device.os, ov.device.version].filter(Boolean).join(" "),
        last_discovered: ov.device.last_discovered,
        last_polled: ov.device.last_polled,
        overlayIps: ov.device.overlayIps?.map((o) => ({ type: o.type, ip: eng.ip(o.ip) })),
      },
      health: ov.health.map((h) => ({ ...h, sensor_descr: eng.scrub(h.sensor_descr) })),
      // ifAlias is an arbitrary admin-authored interface label (e.g. "Linksys-Rack01")
      // with no anonymization-safe registry entry — blanked out rather than scrubbed.
      // The UI only renders it when non-empty and different from ifName.
      topPorts: ov.topPorts.map((p) => ({ ...p, ifAlias: "" })),
      routes: ov.routes.map(anonRoute),
      alerts: ov.alerts.map(anonAlert),
      interfaces: ov.interfaces.map(anonInterface),
    };
  }

  return { topology, overviews };
}
