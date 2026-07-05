import { describe, it, expect } from "vitest";
import { anonymizeTopology } from "./transform";
import type { TopologyResponse, DeviceOverview } from "../../src/types";

function fixture(): { topology: TopologyResponse; overviews: Record<string, DeviceOverview> } {
  const topology: TopologyResponse = {
    sites: [
      {
        id: "blr-r",
        location: "BLR-R",
        lat: 12.2,
        lng: 77.3,
        devices: [
          {
            device_id: 1,
            hostname: "100.81.0.100",
            displayName: "blr01",
            ip: "100.81.0.100",
            lanIp: "10.5.26.1",
            ips: ["10.5.26.1"],
            allIps: ["10.5.26.1", "127.0.0.1"],
            macs: ["8C1645FA1500"],
            os: "linux",
            icon: "cisco.svg",
            status: 1,
            uptime: 100,
            location: "BLR-R",
            hardware: "Cisco Test Router mentions blr01 internally",
            sysName: "blr01",
            totalInRate: 0,
            totalOutRate: 0,
            portCount: 1,
            overlayPorts: [],
          },
        ],
      },
    ],
    overlays: [],
    neighbors: [],
    arpLinks: [],
    arpDevices: [
      {
        mac: "C6485D293A2F",
        macs: ["C6485D293A2F"],
        ips: ["192.168.0.101"],
        vendor: "",
        location: "BLR-R",
        siteId: "blr-r",
        seenByHostname: "100.81.0.100",
        seenByIp: "192.168.0.115",
        firstSeen: "2026-01-01T00:00:00.000Z",
        lastSeen: "2026-01-01T00:00:00.000Z",
        stale: false,
        sourceDown: false,
      },
    ],
    alerts: [],
    lastUpdated: "2026-01-01T00:00:00.000Z",
  };

  const overviews: Record<string, DeviceOverview> = {
    "100.81.0.100": {
      device: {
        device_id: 1,
        hostname: "100.81.0.100",
        displayName: "blr01",
        ip: "100.81.0.100",
        ips: ["10.5.26.1"],
        os: "linux",
        version: "1.0",
        icon: "cisco.svg",
        status: 1,
        status_reason: "",
        location: "BLR-R",
        uptime: 100,
        sysName: "blr01",
        hardware: "Cisco Test Router",
        features: "",
        serial: "REAL-SERIAL-123",
        sysContact: "admin@realcompany.example",
        sysDescr: "Cisco IOS running on blr01",
        last_discovered: "2026-01-01T00:00:00.000Z",
        last_polled: "2026-01-01T00:00:00.000Z",
      },
      health: [],
      topPorts: [],
      routes: [],
      alerts: [],
      interfaces: [],
    },
  };

  return { topology, overviews };
}

describe("anonymizeTopology", () => {
  it("gives the device a fake hostname/displayName and drops geo coordinates", () => {
    const { topology } = anonymizeTopology(fixture().topology, fixture().overviews);
    const device = topology.sites[0].devices[0];
    expect(device.hostname).not.toBe("100.81.0.100");
    expect(device.displayName).not.toBe("blr01");
    expect(device.hostname).toBe(device.displayName); // unified fake identity
    expect(topology.sites[0].lat).toBeNull();
    expect(topology.sites[0].lng).toBeNull();
  });

  it("keeps the discovered device's seenByHostname consistent with the managed device's fake hostname", () => {
    const { topology } = anonymizeTopology(fixture().topology, fixture().overviews);
    const device = topology.sites[0].devices[0];
    const arpDevice = topology.arpDevices[0];
    expect(arpDevice.seenByHostname).toBe(device.hostname);
  });

  it("replaces the real serial and empties sysContact in the overview", () => {
    const { overviews } = anonymizeTopology(fixture().topology, fixture().overviews);
    const anon = Object.values(overviews)[0];
    expect(anon.device.serial).not.toContain("REAL-SERIAL-123");
    expect(anon.device.sysContact).toBe("");
  });

  it("scrubs the real hostname out of free-text fields", () => {
    const { topology } = anonymizeTopology(fixture().topology, fixture().overviews);
    const device = topology.sites[0].devices[0];
    expect(device.hardware).not.toContain("blr01");
  });

  it("replaces sysDescr with a synthesized os/version string, not the real vendor text", () => {
    const { overviews } = anonymizeTopology(fixture().topology, fixture().overviews);
    const anon = Object.values(overviews)[0];
    expect(anon.device.sysDescr).not.toContain("blr01");
    expect(anon.device.sysDescr).not.toContain("Cisco IOS running on");
    expect(anon.device.sysDescr).toBe(`${anon.device.os} ${anon.device.version}`);
  });

  it("keys the overviews map by the fake hostname", () => {
    const { topology, overviews } = anonymizeTopology(fixture().topology, fixture().overviews);
    const device = topology.sites[0].devices[0];
    expect(overviews[device.hostname]).toBeDefined();
    expect(overviews["100.81.0.100"]).toBeUndefined();
  });

  it("leaves loopback addresses in allIps untouched but remaps real LAN IPs", () => {
    const { topology } = anonymizeTopology(fixture().topology, fixture().overviews);
    const device = topology.sites[0].devices[0];
    expect(device.allIps).toContain("127.0.0.1");
    expect(device.allIps).not.toContain("10.5.26.1");
  });
});
