import { readFileSync } from "node:fs";
import type { ArpDiscoveredDevice } from "../../src/types";

// Shuffle-and-slice using an injectable rng (defaults to Math.random, but
// callers pass a seeded generator in tests for reproducible selection).
// Duplicated from randomizeCounts.ts's shuffle rather than imported — it's a
// 6-line pure function, not worth wiring up a shared export for.
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Parses the raw text of an IEEE OUI CSV export (columns: Registry,
 * Assignment, Organization Name, Organization Address) and returns a
 * deduplicated array of non-empty organization names (3rd column).
 *
 * A correct row parser must respect CSV quoting: the organization name may be
 * quoted and contain commas (e.g. "Nokia Shanghai Bell Co., Ltd."), so a
 * naive `split(",")` would break on those rows.
 */
export function parseOuiCsv(csv: string): string[] {
  const lines = csv.split("\n");
  const names: string[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    // skip header
    const line = lines[i];
    if (!line.trim()) continue;

    // Parse just enough fields to reach column 3 (Organization Name),
    // respecting quoting.
    const fields: string[] = [];
    let pos = 0;
    while (fields.length < 3 && pos <= line.length) {
      if (line[pos] === '"') {
        let end = pos + 1;
        let field = "";
        while (end < line.length) {
          if (line[end] === '"') {
            if (line[end + 1] === '"') {
              field += '"';
              end += 2;
              continue;
            }
            break;
          }
          field += line[end];
          end++;
        }
        fields.push(field);
        pos = end + 2; // skip closing quote + following comma
      } else {
        const commaIdx = line.indexOf(",", pos);
        if (commaIdx === -1) {
          fields.push(line.slice(pos));
          pos = line.length + 1;
        } else {
          fields.push(line.slice(pos, commaIdx));
          pos = commaIdx + 1;
        }
      }
    }

    const orgName = (fields[2] ?? "").trim();
    if (orgName && !seen.has(orgName)) {
      seen.add(orgName);
      names.push(orgName);
    }
  }

  return names;
}

/**
 * Reads and parses an IEEE OUI CSV file from disk, returning a deduplicated
 * array of non-empty organization names for use as a random vendor pool.
 */
export function loadVendorPool(csvPath: string): string[] {
  const csv = readFileSync(csvPath, "utf-8");
  return parseOuiCsv(csv);
}

/**
 * Curates ARP-discovered devices for the anonymized demo dataset: drops
 * devices with no resolvable vendor, caps each location to at most 10
 * devices (randomly selected), and assigns every surviving device a random
 * vendor name from `vendorPool` (decoupling the displayed vendor entirely
 * from anything real, consistent with the synthetic MAC already on the
 * device). Never mutates its input.
 */
export function curateArpDevices(
  arpDevices: ArpDiscoveredDevice[],
  vendorPool: string[],
  rng: () => number = Math.random,
): ArpDiscoveredDevice[] {
  const knownVendor = arpDevices.filter((d) => d.vendor.trim() !== "");

  const byLocation = new Map<string, ArpDiscoveredDevice[]>();
  for (const d of knownVendor) {
    const list = byLocation.get(d.location);
    if (list) list.push(d);
    else byLocation.set(d.location, [d]);
  }

  const capped: ArpDiscoveredDevice[] = [];
  for (const devices of byLocation.values()) {
    if (devices.length > 10) {
      capped.push(...shuffle(devices, rng).slice(0, 10));
    } else {
      capped.push(...devices);
    }
  }

  return capped.map((d) => ({
    ...d,
    vendor: vendorPool[Math.floor(rng() * vendorPool.length)],
  }));
}
