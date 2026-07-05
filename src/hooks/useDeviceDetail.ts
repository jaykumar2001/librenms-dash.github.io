import deviceOverviews from "@/data/deviceOverviews.json";
import type { DeviceOverview } from "@/types";

const overviews = deviceOverviews as Record<string, DeviceOverview>;

export function useDeviceDetail(hostname: string | null) {
  return { data: hostname ? overviews[hostname] : undefined, isLoading: false };
}
