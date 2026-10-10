import fs from "node:fs";
import path from "node:path";

const CONFIG_FILE = path.join(process.cwd(), "data", "backend.json");
const DEFAULT_INTERNAL_URL = "http://localhost:8080";

export interface BackendConfig {
  internalUrl: string;
  publicUrl: string;
}

export function readBackendConfig(): BackendConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const json = JSON.parse(raw) as { internalUrl?: unknown; publicUrl?: unknown };
    return {
      internalUrl:
        typeof json.internalUrl === "string" && json.internalUrl.trim()
          ? json.internalUrl.trim()
          : DEFAULT_INTERNAL_URL,
      publicUrl: typeof json.publicUrl === "string" ? json.publicUrl.trim() : "",
    };
  } catch {
    return { internalUrl: DEFAULT_INTERNAL_URL, publicUrl: "" };
  }
}

export function writeBackendConfig(config: BackendConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https/, "wss").replace(/^http(?!s)/, "ws");
}

/** Used by server actions: always hits the backend directly via internalUrl. */
export function getApiBaseUrl(): string {
  return `${readBackendConfig().internalUrl}/v1`;
}

/** Used by client components: uses publicUrl when set, falls back to internalUrl. */
export function getClientApiBaseUrl(): string {
  const { internalUrl, publicUrl } = readBackendConfig();
  return `${publicUrl || internalUrl}/v1`;
}

/** Used by client components for WebSocket: uses publicUrl when set, falls back to internalUrl. */
export function getClientWsBaseUrl(): string {
  const { internalUrl, publicUrl } = readBackendConfig();
  return `${toWsUrl(publicUrl || internalUrl)}/v1`;
}
