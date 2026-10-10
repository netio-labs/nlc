"use server";

import { getApiBaseUrl } from "../lib/backend-config";
import { serverFetch } from "../lib/auth";

export interface HostInterface {
  name: string;
  operstate: string;
  address: string | null;
  mtu: number | null;
}

/** Physical (ether) interfaces on the backend host, used by ioulive86 nodes. */
export async function fetchHostInterfaces(): Promise<HostInterface[]> {
  try {
    const res = await serverFetch(`${getApiBaseUrl()}/host/interfaces`);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { interfaces?: HostInterface[] } };
    return json.data?.interfaces ?? [];
  } catch {
    return [];
  }
}
