import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { curateArpDevices, loadVendorPool, parseOuiCsv } from "./curateArpDevices";
import type { ArpDiscoveredDevice } from "../../src/types";

// Simple seeded LCG (mulberry32) so drop/vendor selection is reproducible
// across runs. Copied from randomizeCounts.test.ts.
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

function makeArpDevice(overrides: Partial<ArpDiscoveredDevice> & { location: string; idx: number }): ArpDiscoveredDevice {
  const { idx, ...rest } = overrides;
  return {
    mac: `02000000${String(idx).padStart(4, "0")}`,
    macs: [`02000000${String(idx).padStart(4, "0")}`],
    ips: [`192.168.0.${idx % 256}`],
    vendor: "Original Vendor Co",
    location: rest.location,
    siteId: "site-x",
    seenByHostname: `host-${idx}`,
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    stale: false,
    sourceDown: false,
    ...rest,
  };
}

// Fixture: "Big Site" has 15 devices (must be capped to 10), "Small Site" has
// 3 devices (must all survive), plus a handful of devices with an empty
// vendor scattered across both locations (must all be dropped regardless of
// which location they're in, before the cap is applied).
function fixtureArpDevices(): ArpDiscoveredDevice[] {
  const devices: ArpDiscoveredDevice[] = [];
  let idx = 0;
  for (let i = 0; i < 15; i++) {
    devices.push(makeArpDevice({ location: "Big Site", idx: idx++ }));
  }
  for (let i = 0; i < 3; i++) {
    devices.push(makeArpDevice({ location: "Small Site", idx: idx++ }));
  }
  // Unknown-vendor devices in both locations — must be dropped in step 1.
  devices.push(makeArpDevice({ location: "Big Site", idx: idx++, vendor: "" }));
  devices.push(makeArpDevice({ location: "Big Site", idx: idx++, vendor: "   " }));
  devices.push(makeArpDevice({ location: "Small Site", idx: idx++, vendor: "" }));
  return devices;
}

// Fixture vendor pool is intentionally disjoint from the fixture devices'
// original "Original Vendor Co" so any survival of the original vendor value
// is unambiguous evidence of a bug (not coincidence).
const vendorPool = ["Acme Corp", "Globex Inc", "Initech LLC"];

describe("curateArpDevices", () => {
  it("drops every device with an empty/whitespace vendor", () => {
    const result = curateArpDevices(fixtureArpDevices(), vendorPool, mulberry32(1));
    for (const d of result) {
      expect(d.vendor.trim()).not.toBe("");
    }
  });

  it("caps any location to at most 10 devices", () => {
    const result = curateArpDevices(fixtureArpDevices(), vendorPool, mulberry32(1));
    const byLocation = new Map<string, number>();
    for (const d of result) byLocation.set(d.location, (byLocation.get(d.location) ?? 0) + 1);
    for (const count of byLocation.values()) {
      expect(count).toBeLessThanOrEqual(10);
    }
    expect(byLocation.get("Big Site")).toBe(10);
  });

  it("keeps all devices in a location with fewer than 10 (post-unknown-removal)", () => {
    const result = curateArpDevices(fixtureArpDevices(), vendorPool, mulberry32(1));
    const smallSiteDevices = result.filter((d) => d.location === "Small Site");
    // 3 known-vendor + 1 empty-vendor dropped in step 1 -> 3 remain.
    expect(smallSiteDevices).toHaveLength(3);
  });

  it("assigns every surviving device a vendor from the pool, never the original", () => {
    const result = curateArpDevices(fixtureArpDevices(), vendorPool, mulberry32(1));
    expect(result.length).toBeGreaterThan(0);
    for (const d of result) {
      expect(vendorPool).toContain(d.vendor);
      expect(d.vendor).not.toBe("Original Vendor Co");
    }
  });

  it("does not mutate the input array or the input devices", () => {
    const input = fixtureArpDevices();
    const inputSnapshot = JSON.parse(JSON.stringify(input));
    const inputLength = input.length;
    curateArpDevices(input, vendorPool, mulberry32(1));
    expect(input).toHaveLength(inputLength);
    expect(input).toEqual(inputSnapshot);
  });
});

describe("parseOuiCsv", () => {
  it("does not split a quoted organization name containing a comma", () => {
    const csv =
      "Registry,Assignment,Organization Name,Organization Address\n" +
      'MA-L,286FB9,"Nokia Shanghai Bell Co., Ltd.","No.388 Ning Qiao Road,Jin Qiao Pudong Shanghai Shanghai   CN 201206 "\n';
    const result = parseOuiCsv(csv);
    expect(result).toEqual(["Nokia Shanghai Bell Co., Ltd."]);
  });

  it("parses an unquoted organization name", () => {
    const csv =
      "Registry,Assignment,Organization Name,Organization Address\n" +
      "MA-L,38E2CA,Katun Corporation,7760 France Ave S Suite 340 Bloomington MN US 55438\n";
    const result = parseOuiCsv(csv);
    expect(result).toEqual(["Katun Corporation"]);
  });

  it("deduplicates identical organization names across rows", () => {
    const csv =
      "Registry,Assignment,Organization Name,Organization Address\n" +
      "MA-L,000001,Acme Corp,123 Main St\n" +
      "MA-L,000002,Acme Corp,456 Other St\n" +
      'MA-L,000003,"Cisco Systems, Inc",80 West Tasman Drive\n';
    const result = parseOuiCsv(csv);
    expect(result).toEqual(["Acme Corp", "Cisco Systems, Inc"]);
  });
});

describe("loadVendorPool", () => {
  it("reads a CSV file from disk and returns deduplicated organization names", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oui-test-"));
    const csvPath = path.join(dir, "oui.csv");
    writeFileSync(
      csvPath,
      "Registry,Assignment,Organization Name,Organization Address\n" +
        'MA-L,286FB9,"Nokia Shanghai Bell Co., Ltd.","No.388 Ning Qiao Road,Jin Qiao Pudong Shanghai Shanghai   CN 201206 "\n' +
        "MA-L,38E2CA,Katun Corporation,7760 France Ave S Suite 340 Bloomington MN US 55438\n" +
        "MA-L,000001,Katun Corporation,Duplicate row\n",
    );
    try {
      const pool = loadVendorPool(csvPath);
      expect(pool).toEqual(["Nokia Shanghai Bell Co., Ltd.", "Katun Corporation"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
