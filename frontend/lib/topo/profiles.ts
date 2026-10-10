import type { FlowNodeData, NlcInterface, NodeType } from "./types";

export const PORTS_PER_SLOT = 4 as const;

export interface IntegerRuntimeFieldDef {
  type: "integer";
  /** Field label in the Build panel; defaults to the runtime key. */
  label?: string;
  default: number;
  min: number;
}

/** A string field chosen from a list provided by the editor (currently only host interfaces). */
export interface SelectRuntimeFieldDef {
  type: "select";
  label?: string;
  default: string;
  options: "hostInterfaces";
}

export type RuntimeFieldDef = IntegerRuntimeFieldDef | SelectRuntimeFieldDef;

/** Runtime defaults for the images of a profile that need different values. */
export interface ImageVariant {
  /** Matched against the image file name; the first matching variant wins. */
  match: RegExp;
  /** Names the variant in hints; the UI translates it (e.g. "iol" → "IOL images"). */
  id: string;
  runtime: Record<string, Partial<IntegerRuntimeFieldDef>>;
}

export interface ProfileDef {
  label: string;
  type: NodeType;
  vendor: string;
  icon: string;
  pattern: string;
  defaultInterfaces: NlcInterface[];
  runtime: Record<string, RuntimeFieldDef>;
  /** If true, slotCount and portsPerSlot are fixed and must not be editable in the UI. */
  fixedInterfaces?: boolean;
  /** If set, the image is locked to this value and cannot be changed in the UI. */
  fixedImage?: string;
  /** Per-image overrides of the runtime defaults. */
  variants?: ImageVariant[];
}

// IOU images: classic IOU (IOS 15.x and earlier) ships as .bin, IOL (IOS XE 17.x)
// as .iol. IOL crashes at boot (MALLOCFAIL) with 256 MB and needs 512 MB.
const IOL_VARIANT: ImageVariant = { match: /\.iol$/i, id: "iol", runtime: { ram: { default: 512 } } };

export const PROFILES: Record<string, ProfileDef> = {
  iouRouter: {
    label: "IOU Router",
    type: "iou",
    vendor: "cisco",
    icon: "iouRouter.svg",
    pattern: "${uiPrefix}${slot}/${port}",
    defaultInterfaces: [
      { family: "ethernet", uiPrefix: "e", slotCount: 2, portsPerSlot: PORTS_PER_SLOT },
      { family: "serial", uiPrefix: "s", slotCount: 2, portsPerSlot: PORTS_PER_SLOT },
    ],
    runtime: {
      nvram: { type: "integer", default: 64, min: 1 },
      ram: { type: "integer", default: 256, min: 1 },
    },
    variants: [IOL_VARIANT],
  },
  iouSwitch: {
    label: "IOU Switch",
    type: "iou",
    vendor: "cisco",
    icon: "iouSwitch.svg",
    pattern: "${uiPrefix}${slot}/${port}",
    defaultInterfaces: [
      { family: "ethernet", uiPrefix: "e", slotCount: 4, portsPerSlot: PORTS_PER_SLOT },
      { family: "serial", uiPrefix: "s", slotCount: 0, portsPerSlot: PORTS_PER_SLOT },
    ],
    runtime: {
      nvram: { type: "integer", default: 64, min: 1 },
      ram: { type: "integer", default: 256, min: 1 },
    },
    variants: [IOL_VARIANT],
  },
  vpc: {
    label: "Virtual PC",
    type: "iou",
    vendor: "nlc",
    icon: "vpc.svg",
    pattern: "${uiPrefix}${port}",
    defaultInterfaces: [{ family: "ethernet", uiPrefix: "eth", slotCount: 1, portsPerSlot: 1 }],
    runtime: {},
    fixedInterfaces: true,
    fixedImage: "NETIO_VIRTUAL_PC",
  },
  container: {
    label: "Container",
    type: "container",
    vendor: "nlc",
    icon: "container.svg",
    pattern: "${uiPrefix}${port}",
    defaultInterfaces: [{ family: "ethernet", uiPrefix: "eth", slotCount: 1, portsPerSlot: 1 }],
    runtime: {},
  },
  ioulive86: {
    label: "IOULive Bridge",
    type: "ioulive86",
    vendor: "nlc",
    icon: "ioulive86.svg",
    // IOU-style names (e0/0, e0/1), so a port is never mistaken for the host NIC it binds to.
    pattern: "${uiPrefix}${slot}/${port}",
    defaultInterfaces: [{ family: "ethernet", uiPrefix: "e", slotCount: 1, portsPerSlot: 1 }],
    runtime: {
      // The host NIC to bridge, or "auto" to bridge a connected container.
      interface: { type: "select", label: "Bind interface", default: "", options: "hostInterfaces" },
    },
    fixedInterfaces: true,
    fixedImage: "ioulive86",
  },
};

/**
 * Set an IOULive86 bridge's bind interface. Its port count follows the mode:
 * a physical NIC bridge has one port (e0/0, IOU side); "auto" adds e0/1 for the
 * container side (see portKind in port-manager.ts).
 */
export function withIoulive86Bind(data: FlowNodeData, bind: string): FlowNodeData {
  const ports = bind === "auto" ? 2 : 1;
  return {
    ...data,
    nlc: {
      ...data.nlc,
      runtime: { ...data.nlc.runtime, interface: bind },
      interfaces: data.nlc.interfaces.map((i) => (i.family === "ethernet" ? { ...i, slotCount: 1, portsPerSlot: ports } : i)),
    },
  };
}

export function imageVariant(profile: ProfileDef, image: string): ImageVariant | undefined {
  return profile.variants?.find((v) => v.match.test(image));
}

/** The profile's runtime fields with the image's variant applied. */
export function runtimeFieldsFor(profile: ProfileDef, image: string): Record<string, RuntimeFieldDef> {
  const overrides = imageVariant(profile, image)?.runtime ?? {};
  return Object.fromEntries(
    Object.entries(profile.runtime).map(([key, def]) =>
      [key, def.type === "integer" && overrides[key] ? { ...def, ...overrides[key] } : def]),
  );
}

export function inferNodeNamePrefix(profile: string): string {
  if (profile.toLowerCase().includes("router")) return "r";
  if (profile.toLowerCase().includes("switch")) return "s";
  if (profile.toLowerCase().includes("firewall")) return "f";
  if (profile.toLowerCase().includes("vpc")) return "vpc";
  if (profile.toLowerCase().includes("ioulive")) return "lan";
  if (profile.toLowerCase().includes("container")) return "c";
  return "d";
}
