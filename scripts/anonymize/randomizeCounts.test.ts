import { describe, it, expect } from "vitest";
import { randomizeDeviceCounts } from "./randomizeCounts";
import type { TopologyResponse, DeviceOverview, DeviceSummary, ArpDiscoveredDevice } from "../../src/types";

// Simple seeded LCG (mulberry32) so drop selection is reproducible across runs.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDevice(hostname: string, location: string): DeviceSummary {
  return {
    device_id: hostname.length,
    hostname,
    displayName: hostname,
    ip: "10.200.0.1",
    lanIp: "10.200.0.1",
    ips: ["10.200.0.1"],
    allIps: ["10.200.0.1"],
    macs: ["020000000001"],
    os: "linux",
    icon: "generic.svg",
    status: 1,
    uptime: 100,
    location,
    hardware: "Test Hardware",
    sysName: hostname,
    totalInRate: 0,
    totalOutRate: 0,
    portCount: 1,
    overlayPorts: [],
  };
}

function makeArpDevice(seenByHostname: string, siteId: string, location: string, idx: number): ArpDiscoveredDevice {
  return {
    mac: `02000000${String(idx).padStart(4, "0")}`,
    macs: [`02000000${String(idx).padStart(4, "0")}`],
    ips: [`192.168.0.${idx}`],
    vendor: "",
    location,
    siteId,
    seenByHostname,
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    stale: false,
    sourceDown: false,
  };
}

// 3 sites: "site-a" has a single device (must survive untouched, per the
// per-site minimum-1 floor); "site-b" and "site-c" have several devices each
// so the candidate pool for dropping has 7 members (4 + 3), out of 8 total
// managed devices. round(8 * fraction) for fraction in [0.10, 0.20] is always
// >= 1 (round(0.8) = 1) and <= 2 (round(1.6) = 2), so this fixture
// deterministically exercises a real drop without over-fitting to exact RNG
// internals.
function fixture(): { topology: TopologyResponse; overviews: Record<string, DeviceOverview> } {
  const topology: TopologyResponse = {
    sites: [
      { id: "site-a", location: "Site A", lat: null, lng: null, devices: [makeDevice("a1", "Site A")] },
      {
        id: "site-b",
        location: "Site B",
        lat: null,
        lng: null,
        devices: [
          makeDevice("b1", "Site B"),
          makeDevice("b2", "Site B"),
          makeDevice("b3", "Site B"),
          makeDevice("b4", "Site B"),
        ],
      },
      {
        id: "site-c",
        location: "Site C",
        lat: null,
        lng: null,
        devices: [makeDevice("c1", "Site C"), makeDevice("c2", "Site C"), makeDevice("c3", "Site C")],
      },
    ],
    overlays: [
      {
        overlayType: "wireguard",
        subnet: "10.200.1.0/24",
        color: "#000",
        label: "mesh-group",
        topology: "mesh",
        links: [
          { overlayType: "wireguard", subnet: "10.200.1.0/24", from: "b1", to: "b2", fromIp: "10.200.1.1", toIp: "10.200.1.2" },
          { overlayType: "wireguard", subnet: "10.200.1.0/24", from: "b3", to: "c1", fromIp: "10.200.1.3", toIp: "10.200.1.4" },
          { overlayType: "wireguard", subnet: "10.200.1.0/24", from: "a1", to: "b4", fromIp: "10.200.1.5", toIp: "10.200.1.6" },
        ],
      },
      {
        overlayType: "tailscale",
        subnet: "10.200.2.0/24",
        color: "#111",
        label: "hub-spoke-group",
        topology: "hub-spoke",
        hub: "b1",
        links: [
          { overlayType: "tailscale", subnet: "10.200.2.0/24", from: "b2", to: "b1", fromIp: "10.200.2.1", toIp: "10.200.2.2" },
          { overlayType: "tailscale", subnet: "10.200.2.0/24", from: "c2", to: "b1", fromIp: "10.200.2.3", toIp: "10.200.2.4" },
        ],
      },
    ],
    neighbors: [
      { id: 1, localDeviceId: 1, localHostname: "a1", localPort: "eth0", remoteDeviceId: 2, remoteHostname: "b1", remotePort: "eth0", protocol: "lldp" },
      { id: 2, localDeviceId: 2, localHostname: "b2", localPort: "eth0", remoteDeviceId: 3, remoteHostname: "c1", remotePort: "eth0", protocol: "lldp" },
      { id: 3, localDeviceId: 3, localHostname: "b3", localPort: "eth0", remoteDeviceId: 4, remoteHostname: "b4", remotePort: "eth0", protocol: "lldp" },
    ],
    arpLinks: [
      { fromHostname: "a1", toHostname: "b2", fromIp: "10.200.0.1", toIp: "10.200.0.2", mac: "020000000002", sourceDown: false },
      { fromHostname: "c1", toHostname: "c2", fromIp: "10.200.0.3", toIp: "10.200.0.4", mac: "020000000003", sourceDown: false },
      { fromHostname: "b1", toHostname: "b3", fromIp: "10.200.0.5", toIp: "10.200.0.6", mac: "020000000004", sourceDown: false },
    ],
    arpDevices: [
      makeArpDevice("a1", "site-a", "Site A", 1),
      makeArpDevice("a1", "site-a", "Site A", 2),
      makeArpDevice("b1", "site-b", "Site B", 3),
      makeArpDevice("b1", "site-b", "Site B", 4),
      makeArpDevice("b2", "site-b", "Site B", 5),
      makeArpDevice("b2", "site-b", "Site B", 6),
      makeArpDevice("b3", "site-b", "Site B", 7),
      makeArpDevice("b3", "site-b", "Site B", 8),
      makeArpDevice("b4", "site-b", "Site B", 9),
      makeArpDevice("b4", "site-b", "Site B", 10),
      makeArpDevice("c1", "site-c", "Site C", 11),
      makeArpDevice("c1", "site-c", "Site C", 12),
      makeArpDevice("c2", "site-c", "Site C", 13),
      makeArpDevice("c2", "site-c", "Site C", 14),
      makeArpDevice("c3", "site-c", "Site C", 15),
      makeArpDevice("c3", "site-c", "Site C", 16),
    ],
    alerts: [
      { id: 1, device_id: 1, hostname: "a1", rule: "cpu", severity: "warning", state: 1, timestamp: "2026-01-01T00:00:00.000Z" },
      { id: 2, device_id: 2, hostname: "b1", rule: "cpu", severity: "warning", state: 1, timestamp: "2026-01-01T00:00:00.000Z" },
      { id: 3, device_id: 3, hostname: "b2", rule: "cpu", severity: "warning", state: 1, timestamp: "2026-01-01T00:00:00.000Z" },
      { id: 4, device_id: 4, hostname: "c1", rule: "cpu", severity: "warning", state: 1, timestamp: "2026-01-01T00:00:00.000Z" },
      { id: 5, device_id: 5, hostname: "c3", rule: "cpu", severity: "warning", state: 1, timestamp: "2026-01-01T00:00:00.000Z" },
    ],
    lastUpdated: "2026-01-01T00:00:00.000Z",
  };

  const overviews: Record<string, DeviceOverview> = {};
  for (const site of topology.sites) {
    for (const d of site.devices) {
      overviews[d.hostname] = {
        device: {
          device_id: d.device_id,
          hostname: d.hostname,
          displayName: d.displayName,
          ip: d.ip,
          ips: d.ips,
          os: d.os,
          version: "1.0",
          icon: d.icon,
          status: d.status,
          status_reason: "",
          location: d.location,
          uptime: d.uptime,
          sysName: d.sysName,
          hardware: d.hardware,
          features: "",
          serial: "",
          sysContact: "",
          sysDescr: "linux 1.0",
          last_discovered: "2026-01-01T00:00:00.000Z",
          last_polled: "2026-01-01T00:00:00.000Z",
        },
        health: [],
        topPorts: [],
        routes: [],
        alerts: [],
        interfaces: [],
      };
    }
  }

  return { topology, overviews };
}

function presentHostnames(topology: TopologyResponse): Set<string> {
  const set = new Set<string>();
  for (const site of topology.sites) {
    for (const d of site.devices) set.add(d.hostname);
  }
  return set;
}

describe("randomizeDeviceCounts", () => {
  it("drops roughly 10-20% of managed devices", () => {
    const { topology: before } = fixture();
    const totalBefore = before.sites.reduce((n, s) => n + s.devices.length, 0);
    const { topology: after } = randomizeDeviceCounts(before, fixture().overviews, mulberry32(12345));
    const totalAfter = after.sites.reduce((n, s) => n + s.devices.length, 0);

    expect(totalAfter).toBeLessThan(totalBefore);
    expect(totalAfter).toBeGreaterThanOrEqual(totalBefore * 0.75);
  });

  it("never drops the last device from a single-device site", () => {
    const { topology, overviews } = fixture();
    const { topology: after } = randomizeDeviceCounts(topology, overviews, mulberry32(12345));
    const siteA = after.sites.find((s) => s.id === "site-a")!;
    expect(siteA.devices).toHaveLength(1);
    expect(siteA.devices[0].hostname).toBe("a1");
  });

  it("does not mutate the input topology/overviews", () => {
    const { topology, overviews } = fixture();
    const totalBefore = topology.sites.reduce((n, s) => n + s.devices.length, 0);
    randomizeDeviceCounts(topology, overviews, mulberry32(12345));
    const totalStillBefore = topology.sites.reduce((n, s) => n + s.devices.length, 0);
    expect(totalStillBefore).toBe(totalBefore);
  });

  it("cascades the drop through neighbors, arpLinks, overlays, alerts, overviews, and arpDevices referentially", () => {
    const { topology, overviews } = fixture();
    const { topology: after, overviews: afterOverviews } = randomizeDeviceCounts(topology, overviews, mulberry32(12345));
    const present = presentHostnames(after);

    for (const n of after.neighbors) {
      expect(present.has(n.localHostname)).toBe(true);
      expect(present.has(n.remoteHostname)).toBe(true);
    }

    for (const l of after.arpLinks) {
      expect(present.has(l.fromHostname)).toBe(true);
      expect(present.has(l.toHostname)).toBe(true);
    }

    for (const group of after.overlays) {
      expect(group.links.length).toBeGreaterThan(0);
      if (group.topology === "hub-spoke" && group.hub) {
        expect(present.has(group.hub)).toBe(true);
      }
      for (const link of group.links) {
        expect(present.has(link.from)).toBe(true);
        expect(present.has(link.to)).toBe(true);
      }
    }

    for (const a of after.alerts) {
      expect(present.has(a.hostname)).toBe(true);
    }

    for (const hostname of Object.keys(afterOverviews)) {
      expect(present.has(hostname)).toBe(true);
    }
    for (const hostname of present) {
      expect(afterOverviews[hostname]).toBeDefined();
    }

    for (const d of after.arpDevices) {
      expect(present.has(d.seenByHostname)).toBe(true);
    }
  });

  it("never drains every device out of a small multi-device site, across many seeds", () => {
    // A 2-device site is the tightest case where a naive global-pool shuffle
    // could pick both of its devices. Sweep many seeds/fractions to catch it.
    for (let seed = 0; seed < 200; seed++) {
      const topology: TopologyResponse = {
        sites: [
          { id: "site-a", location: "Site A", lat: null, lng: null, devices: [makeDevice("a1", "Site A")] },
          {
            id: "site-d",
            location: "Site D",
            lat: null,
            lng: null,
            devices: [makeDevice("d1", "Site D"), makeDevice("d2", "Site D")],
          },
          {
            id: "site-big",
            location: "Site Big",
            lat: null,
            lng: null,
            // 7 devices so total = 1 + 2 + 7 = 10, giving dropCount = round(10 *
            // [0.1-0.2]) = 1 or 2 — large enough that "both site-d devices land
            // in the drop" is a real, reachable outcome to sweep for, not
            // structurally impossible like the 6-device version of this fixture.
            devices: Array.from({ length: 7 }, (_, i) => makeDevice(`big${i + 1}`, "Site Big")),
          },
        ],
        overlays: [],
        neighbors: [],
        arpLinks: [],
        arpDevices: [],
        alerts: [],
        lastUpdated: "2026-01-01T00:00:00.000Z",
      };
      const overviews: Record<string, DeviceOverview> = {};
      for (const site of topology.sites) {
        for (const d of site.devices) {
          overviews[d.hostname] = {
            device: {
              device_id: d.device_id, hostname: d.hostname, displayName: d.displayName, ip: d.ip, ips: d.ips,
              os: d.os, version: "1.0", icon: d.icon, status: d.status, status_reason: "", location: d.location,
              uptime: d.uptime, sysName: d.sysName, hardware: d.hardware, features: "", serial: "", sysContact: "",
              sysDescr: "linux 1.0", last_discovered: "2026-01-01T00:00:00.000Z", last_polled: "2026-01-01T00:00:00.000Z",
            },
            health: [], topPorts: [], routes: [], alerts: [], interfaces: [],
          };
        }
      }
      const { topology: after } = randomizeDeviceCounts(topology, overviews, mulberry32(seed));
      const siteD = after.sites.find((s) => s.id === "site-d")!;
      expect(siteD.devices.length).toBeGreaterThanOrEqual(1);
    }
  });
});
