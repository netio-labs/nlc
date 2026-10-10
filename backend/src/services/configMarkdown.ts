/*
 * Saved configurations as Markdown: one "## <device name>" section per
 * device, whose first fenced code block is the device's startup config. The
 * same text is the stored file and the export/import format; anything else
 * in the file (notes, lab instructions) is ignored by the parser and kept.
 *
 *   # <configuration name>
 *
 *   - Lab: <lab name>
 *   - Saved: 2026-09-29 10:15:00
 *
 *   ## r1
 *
 *   - Type: iouRouter
 *
 *   ```text
 *   hostname r1
 *   ...
 *   ```
 *
 * IOS stores banner delimiters as the control character 0x03; the Markdown
 * shows them as "^C" (as `show running-config` does) and they are turned back
 * into 0x03 on parse.
 */

export interface DeviceConfig {
  name: string;
  type?: string;
  /** Startup config; "" means the section's code block is empty (device should be blank). */
  config: string;
}

export interface ConfigDocument {
  title: string;
  lab: string;
  savedAt: Date;
  devices: DeviceConfig[];
}

const BANNER_DELIMITER = "\x03";

function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// A fence longer than any backtick run in the content, so the content can't close it.
function fenceFor(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function renderConfigMarkdown(doc: ConfigDocument): string {
  const out = [`# ${doc.title}`, "", `- Lab: ${doc.lab}`, `- Saved: ${formatTime(doc.savedAt)}`, ""];
  for (const device of doc.devices) {
    const config = device.config.replaceAll(BANNER_DELIMITER, "^C").replace(/\r\n/g, "\n");
    const body = config.endsWith("\n") || config === "" ? config : config + "\n";
    const fence = fenceFor(config);
    out.push(`## ${device.name}`, "");
    if (device.type) out.push(`- Type: ${device.type}`, "");
    out.push(`${fence}text`, body + fence, "");
  }
  return out.join("\n");
}

/** Devices in file order; duplicate names are kept for the caller to report. */
export function parseConfigMarkdown(markdown: string): DeviceConfig[] {
  const devices: DeviceConfig[] = [];
  let current: { name: string; type?: string; config?: string } | null = null;
  let fence: { char: string; len: number; capture: boolean } | null = null;
  let captured: string[] = [];

  const flush = () => {
    if (current?.config !== undefined) devices.push(current as DeviceConfig);
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence.char === "`" ? "`" : "~"}{${fence.len},}\\s*$`);
      if (close.test(line)) {
        if (fence.capture && current) current.config = restoreBanners(captured.length ? captured.join("\n") + "\n" : "");
        fence = null;
      } else if (fence.capture) {
        captured.push(line);
      }
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = { char: open[1][0], len: open[1].length, capture: !!current && current.config === undefined };
      captured = [];
      continue;
    }
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && !line.startsWith("###")) {
      flush();
      current = { name: heading[1] };
      continue;
    }
    if (current && current.config === undefined) {
      const type = /^\s*[-*]\s+Type:\s*(.+?)\s*$/i.exec(line);
      if (type) current.type = type[1];
    }
  }
  flush();
  return devices;
}

/**
 * "^C" back to 0x03, but only where it delimits a banner, so a literal "^C"
 * elsewhere (a description, say) is left alone:
 *   banner motd ^CAuthorized only^C        (one line)
 *   banner motd ^C / text... / ^C          (multi-line)
 */
function restoreBanners(config: string): string {
  const lines = config.split("\n");
  let inBanner = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!inBanner) {
      const m = /^(\s*banner\s+[\w-]+\s+)\^C/.exec(line);
      if (!m) continue;
      line = m[1] + BANNER_DELIMITER + line.slice(m[0].length);
      inBanner = true;
      const rest = line.slice(m[1].length + 1);
      const close = rest.indexOf("^C");
      if (close >= 0) {
        line = m[1] + BANNER_DELIMITER + rest.slice(0, close) + BANNER_DELIMITER + rest.slice(close + 2);
        inBanner = false;
      }
    } else {
      const close = line.indexOf("^C");
      if (close >= 0) {
        line = line.slice(0, close) + BANNER_DELIMITER + line.slice(close + 2);
        inBanner = false;
      }
    }
    lines[i] = line;
  }
  return lines.join("\n");
}
