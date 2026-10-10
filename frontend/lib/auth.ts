"server-only";

import { cookies } from "next/headers";

export async function getAuthToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get("nlc-token")?.value;
}

export async function serverFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
