import type {
  TopologyResponse,
  DeviceOverview,
  SubnetGroup,
} from "../../src/types";

// Shuffle-and-slice using an injectable rng (defaults to Math.random, but
// callers pass a seeded generator in tests for reproducible drop selection).
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Subtractive-only randomization of the published device counts: drops a
 * random 10-20% of managed devices (never fabricates any), then cascades
 * that drop through every structure that references a hostname. Never
 * mutates its inputs.
 */
export function randomizeDeviceCounts(
  topology: TopologyResponse,
  overviews: Record<string, DeviceOverview>,
  rng: () => number = Math.random,
): { topology: TopologyResponse; overviews: Record<string, DeviceOverview> } {
  const totalDevices = topology.sites.reduce((n, s) => n + s.devices.length, 0);
  const fraction = 0.1 + rng() * 0.1;
  const dropCount = Math.round(totalDevices * fraction);

  // Candidates carry their site so we can enforce a *per-site* floor of 1
  // remaining device below — a global candidate pool alone doesn't prevent
  // draining every device out of a small (e.g. 2-device) site if the shuffle
  // happens to pick all of them.
  const candidatePool: { hostname: string; siteId: string }[] = [];
  for (const site of topology.sites) {
    if (site.devices.length > 1) {
      for (const d of site.devices) candidatePool.push({ hostname: d.hostname, siteId: site.id });
    }
  }

  const remainingBySite = new Map<string, number>();
  for (const site of topology.sites) remainingBySite.set(site.id, site.devices.length);

  const droppedHostnames = new Set<string>();
  for (const cand of shuffle(candidatePool, rng)) {
    if (droppedHostnames.size >= dropCount) break;
    const remaining = remainingBySite.get(cand.siteId)!;
    if (remaining <= 1) continue; // would empty this site — skip
    droppedHostnames.add(cand.hostname);
    remainingBySite.set(cand.siteId, remaining - 1);
  }

  const newSites = topology.sites.map((site) => ({
    ...site,
    devices: site.devices.filter((d) => !droppedHostnames.has(d.hostname)),
  }));

  const newOverviews: Record<string, DeviceOverview> = {};
  for (const [hostname, overview] of Object.entries(overviews)) {
    if (!droppedHostnames.has(hostname)) newOverviews[hostname] = overview;
  }

  const newNeighbors = topology.neighbors.filter(
    (n) => !droppedHostnames.has(n.localHostname) && !droppedHostnames.has(n.remoteHostname),
  );

  const newArpLinks = topology.arpLinks.filter(
    (l) => !droppedHostnames.has(l.fromHostname) && !droppedHostnames.has(l.toHostname),
  );

  const newOverlays: SubnetGroup[] = [];
  for (const group of topology.overlays) {
    if (group.topology === "hub-spoke" && group.hub && droppedHostnames.has(group.hub)) {
      continue;
    }
    const links = group.links.filter((l) => !droppedHostnames.has(l.from) && !droppedHostnames.has(l.to));
    if (links.length === 0) continue;
    newOverlays.push({ ...group, links });
  }

  const newAlerts = topology.alerts.filter((a) => !droppedHostnames.has(a.hostname));

  const newArpDevices = topology.arpDevices.filter((d) => !droppedHostnames.has(d.seenByHostname));

  return {
    topology: {
      ...topology,
      sites: newSites,
      overlays: newOverlays,
      neighbors: newNeighbors,
      arpLinks: newArpLinks,
      arpDevices: newArpDevices,
      alerts: newAlerts,
    },
    overviews: newOverviews,
  };
}
