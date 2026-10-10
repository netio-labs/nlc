import fs from "node:fs";
import path from "node:path";

const cwd = path.resolve(".");
const iouDir = path.join(cwd, "addons", "iou");

function resolvePodman(): string {
  for (const p of ["/usr/bin/podman", "/usr/local/bin/podman", "/bin/podman"]) {
    if (fs.existsSync(p)) return p;
  }
  return "podman";
}

function resolveNetioDir(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return `/tmp/netio${uid}`;
}

export const DLT_MAP: Record<string, number> = {
  ethernet: 1,
  ppp: 9,
  hdlc: 104,
  framrelay: 107,
};

export const CONFIG = {
  auth: {
    secret: process.env.JWT_SECRET ?? "dev-secret-change-in-prod",
  },
  rootDir: cwd,
  labsDir: path.join(cwd, "labs"),
  // Saved device configuration versions, one folder per lab (see services/configs.ts).
  configurationsDir: path.join(cwd, "configurations"),
  dbPath: path.join(cwd, "data", "nlc.sqlite"),
  enableLog: false,
  enableDebug: {
    capture: true,
    iou: true,
    ioulive86: true,
    container: true,
    shell: true,
  },
  runtimeDir: "./running",
  host: "0.0.0.0",
  port: 8080,
  captureListenHost: "0.0.0.0",
  captureAdvertiseHost: "0.0.0.0",
  captureBasePort: 30000,
  maxCaptures: 1024,
  consoleBasePort: 20000,
  iouDir,
  iouWrapper: path.join(iouDir, "wrapper-linux"),
  iourc: path.join(iouDir, "iourc"),
  // ioulive86 needs CAP_NET_RAW; it is started through sudo (see deploy/nlc-ioulive86.sudoers)
  // and drops back to the backend user right after opening the raw socket.
  ioulive86Bin: path.join(iouDir, "ioulive86"),
  ioulive86Sudo: "sudo",
  // Container nodes: rootful podman via sudo (see deploy/nlc-podman.sudoers) — cEOS and
  // similar images need real root (e.g. debugfs mounts), which rootless userns cannot give.
  // Veth plumbing goes through nlc-netns-helper. Container consoles reuse
  // consoleBasePort + instanceId (ids are globally unique), so no separate port range is needed.
  podmanBin: resolvePodman(),
  podmanSudo: "/usr/bin/sudo", // absolute: the console wrapper checks -m with access(X_OK)
  netnsHelper: path.join(cwd, "addons", "helper", "nlc-netns-helper"),
  // Per-image run command / options / console shell (see services/containerCatalog.ts).
  containerCatalog: path.join(cwd, "catalog", "container.json"),
  podvethPrefix: "podveth",
  netioDir: resolveNetioDir(),
  iouRuntimeDefaults: {
    ram: 256,
    nvram: 64,
  },
  iouProcessDefaults: {
    delay: 0,
    l2keepalive: false,
    watchdog: true,
    ignoreNetmap: false,
  },
};
