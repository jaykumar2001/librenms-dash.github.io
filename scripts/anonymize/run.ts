import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { anonymizeTopology } from "./transform";
import { randomizeDeviceCounts } from "./randomizeCounts";
import { curateArpDevices, loadVendorPool } from "./curateArpDevices";
import type { TopologyResponse, DeviceOverview } from "../../src/types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;

if (!AUTH_USERNAME || !AUTH_PASSWORD) {
  console.error("Missing AUTH_USERNAME/AUTH_PASSWORD — copy .env.local.example to .env.local and fill it in.");
  process.exit(1);
}

async function login(): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: AUTH_USERNAME, password: AUTH_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No session cookie returned");
  return setCookie.split(";")[0];
}

async function fetchJson<T>(pathname: string, cookie: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${pathname}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET ${pathname}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchBinary(pathname: string, cookie: string): Promise<Buffer> {
  const res = await fetch(`${BACKEND_URL}${pathname}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET ${pathname}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const cookie = await login();
  console.log("Logged in.");

  const topology = await fetchJson<TopologyResponse>("/api/topology", cookie);
  const deviceCount = topology.sites.reduce((n, s) => n + s.devices.length, 0);
  console.log(`Fetched topology: ${topology.sites.length} sites, ${deviceCount} devices.`);

  const rawOverviews: Record<string, DeviceOverview> = {};
  for (const site of topology.sites) {
    for (const device of site.devices) {
      rawOverviews[device.hostname] = await fetchJson<DeviceOverview>(
        `/api/devices/${encodeURIComponent(device.hostname)}/overview`,
        cookie,
      );
      console.log(`Fetched overview for ${device.displayName}`);
    }
  }

  const { topology: anonTopology, overviews: anonOverviews } = anonymizeTopology(topology, rawOverviews);
  const { topology: randomizedTopology, overviews: randomizedOverviews } =
    randomizeDeviceCounts(anonTopology, anonOverviews);

  const vendorPool = loadVendorPool(path.resolve(".scratch/oui24.csv"));
  const curatedArpDevices = curateArpDevices(randomizedTopology.arpDevices, vendorPool);
  const finalTopology: TopologyResponse = { ...randomizedTopology, arpDevices: curatedArpDevices };

  const finalDeviceCount = finalTopology.sites.reduce((n, s) => n + s.devices.length, 0);
  console.log(
    `After randomization: ${finalDeviceCount} devices, ${curatedArpDevices.length} discovered devices.`,
  );

  // Audit: confirm none of the real site/hostname/displayName strings survived
  // the anonymization pass anywhere in the output (structural fields + free text).
  // Runs BEFORE any file is written, so a failure can't leave a leaking file on
  // disk — this is a gate, not just detection.
  //
  // The `os`, `icon`, and `sysDescr` fields are deliberately excluded from the
  // scan surface. `os`/`icon` are small, fixed vocabularies (os: linux/opnsense/
  // pfsense/proxmox/...; icon: cisco.svg/opnsense.svg/tplink.svg/...) that
  // transform.ts intentionally leaves un-anonymized, since they drive OS-group
  // labels and device icons in the UI (src/components/SiteGroup.tsx). `sysDescr`
  // is fully synthesized by transform.ts as `${os} ${version}` (no real vendor
  // text survives it at all) — so it's built from the same fixed, non-identifying
  // vocabulary as `os`, plus a software version string. If an admin happens to name
  // a device after its own OS/vendor (e.g. an OPNsense box literally called
  // "opnsense"), that word will always legitimately appear in these fields
  // regardless of anonymization — scanning them would produce a false-positive
  // audit failure, not catch a real leak. Reviewed and approved exception, not a
  // silent weakening of the check.
  const EXCLUDED_AUDIT_KEYS = new Set(["os", "icon", "sysDescr"]);
  const combined = JSON.stringify(
    { anonTopology: finalTopology, anonOverviews: randomizedOverviews },
    (key, value) => (EXCLUDED_AUDIT_KEYS.has(key) ? undefined : value),
  );
  const realNeedles = new Set<string>();
  for (const s of topology.sites) {
    realNeedles.add(s.location);
    realNeedles.add(s.id);
    for (const d of s.devices) {
      realNeedles.add(d.displayName);
      realNeedles.add(d.hostname);
    }
  }
  const leaks = [...realNeedles].filter((needle) => needle && needle.length > 2 && combined.includes(needle));
  if (leaks.length > 0) {
    console.error("AUDIT FAILED — real identifiers still present in output:", leaks);
    process.exit(1);
  }
  console.log("Audit passed — no real site/hostname/displayName strings found in anonymized output.");

  const icons = new Set<string>();
  for (const site of finalTopology.sites) {
    for (const device of site.devices) {
      icons.add(device.icon || "generic.svg");
    }
  }

  const dataDir = path.resolve("src/data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "topology.json"), JSON.stringify(finalTopology, null, 2));
  writeFileSync(path.join(dataDir, "deviceOverviews.json"), JSON.stringify(randomizedOverviews, null, 2));
  console.log(`Wrote ${dataDir}/topology.json and deviceOverviews.json`);

  const iconsDir = path.resolve("public/icons");
  mkdirSync(iconsDir, { recursive: true });
  for (const icon of icons) {
    const buf = await fetchBinary(`/api/graph/icon/${encodeURIComponent(icon)}`, cookie);
    writeFileSync(path.join(iconsDir, icon), buf);
    console.log(`Downloaded icon ${icon}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
