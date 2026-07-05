import { useEffect, useRef, useState } from "react";
import topologyData from "@/data/topology.json";
import type { AssetEvent, TopologyResponse } from "@/types";

const topology = topologyData as TopologyResponse;

const TICK_BASE_MS = 20_000;
const TICK_JITTER_MS = 10_000;
const MAX_EVENTS = 200;

function formatMacColon(mac: string): string {
  return mac.replace(/(.{2})(?=.)/g, "$1:");
}

export function useDemoEvents() {
  const [allEvents, setAllEvents] = useState<AssetEvent[]>([]);
  const idRef = useRef(1);

  useEffect(() => {
    const pool = topology.arpDevices;
    if (pool.length === 0) return;

    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const device = pool[Math.floor(Math.random() * pool.length)];
      const action: AssetEvent["action"] = Math.random() < 0.7 ? "added" : "removed";
      const event: AssetEvent = {
        id: idRef.current++,
        timestamp: new Date().toISOString(),
        action,
        category: "discovered-device",
        asset: `${formatMacColon(device.mac)} at ${device.location}`,
      };
      setAllEvents((prev) => {
        const merged = [...prev, event];
        return merged.length > MAX_EVENTS ? merged.slice(-MAX_EVENTS) : merged;
      });
      timer = setTimeout(tick, TICK_BASE_MS + Math.random() * TICK_JITTER_MS);
    };

    timer = setTimeout(tick, TICK_BASE_MS + Math.random() * TICK_JITTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return { allEvents, connected: true };
}
