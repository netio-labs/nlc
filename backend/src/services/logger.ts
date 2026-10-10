import { CONFIG } from "../config.ts";

export type DebugScope = keyof typeof CONFIG.enableDebug;

const green = "\x1b[32m";
const reset = "\x1b[0m";

export function logDebug(scope: DebugScope, event: string, details: Record<string, unknown> = {}): void {
  if (!CONFIG.enableDebug[scope]) return;
  console.log(
    `${green}[${scope}]${reset} ${event} ${JSON.stringify({
      time: new Date().toLocaleString("zh-CN", { hour12: false }),
      ...details,
    })}`,
  );
}
