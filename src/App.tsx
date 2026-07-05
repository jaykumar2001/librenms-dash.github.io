import topologyData from "@/data/topology.json";
import type { TopologyResponse } from "@/types";
import { TopologyMap } from "@/components/TopologyMap";
import { useDemoEvents } from "@/hooks/useDemoEvents";

const data = topologyData as TopologyResponse;

export function App() {
  const sse = useDemoEvents();
  return <TopologyMap data={data} sse={sse} />;
}
