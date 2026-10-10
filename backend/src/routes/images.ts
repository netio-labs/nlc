import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import { CONFIG } from "../config.ts";
import {
  getErrorCode,
  listContainerImages,
  loadContainerCatalog,
  matchContainerCatalog,
  type ContainerCatalogEntry,
} from "../services/index.ts";

const IOU_IMAGE_PREFIX = "I86BI_LINUX";
const IOU_SWITCH_IMAGE_PREFIX = "I86BI_LINUX_L2";
const SUPPORTED_PROFILES = new Set(["iouSwitch", "iouRouter"]);

function matchesProfile(fileName: string, profile?: string): boolean {
  if (!fileName.startsWith(IOU_IMAGE_PREFIX)) {
    return false;
  }

  if (!profile) {
    return true;
  }
  if (profile === "iouSwitch") {
    return fileName.startsWith(IOU_SWITCH_IMAGE_PREFIX);
  }
  if (profile === "iouRouter") {
    return !fileName.startsWith(IOU_SWITCH_IMAGE_PREFIX);
  }
  return false;
}

function isValidImageName(fileName: string): boolean {
  return fileName.startsWith(IOU_IMAGE_PREFIX) || fileName.startsWith(IOU_SWITCH_IMAGE_PREFIX);
}

function normalizeImageName(fileName: string): string | null {
  const rawName = fileName.trim();
  const safeName = path.basename(rawName);
  if (!rawName || safeName !== rawName || rawName.includes("/") || rawName.includes("\\")) {
    return null;
  }
  if (!isValidImageName(safeName)) {
    return null;
  }
  return safeName;
}

export async function iouImageRoutes(app: FastifyInstance) {
  app.post("/", async (req, reply) => {
    let filePart: Awaited<ReturnType<typeof req.file>>;
    try {
      filePart = await req.file();
    } catch {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "INVALID_UPLOAD",
          message: "Request must be multipart/form-data with one file field.",
        },
      });
    }

    if (!filePart) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "FILE_REQUIRED",
          message: "No file uploaded.",
        },
      });
    }

    const safeName = normalizeImageName(filePart.filename ?? "");
    if (!safeName) {
      filePart.file.resume();
      return reply.status(400).send({
        ok: false,
        error: {
          code: "INVALID_IMAGE_NAME",
          message: 'Image filename must start with "I86BI_LINUX" or "I86BI_LINUX_L2".',
        },
      });
    }

    fs.mkdirSync(CONFIG.iouDir, { recursive: true });
    const filePath = path.join(CONFIG.iouDir, safeName);
    if (fs.existsSync(filePath)) {
      filePart.file.resume();
      return reply.status(409).send({
        ok: false,
        error: {
          code: "IMAGE_ALREADY_EXISTS",
          message: `Image ${safeName} already exists.`,
        },
      });
    }

    try {
      await pipeline(filePart.file, fs.createWriteStream(filePath, { flags: "wx" }));
      // busboy stops emitting data once the fileSize limit is hit but still
      // ends the stream normally, so pipeline() resolves "successfully" with
      // a truncated file unless we explicitly check for this.
      if (filePart.file.truncated) {
        fs.unlinkSync(filePath);
        return reply.status(413).send({
          ok: false,
          error: { code: "FILE_TOO_LARGE", message: "Uploaded file exceeds the maximum allowed size." },
        });
      }
      fs.chmodSync(filePath, 0o755);
      const stat = fs.statSync(filePath);
      return reply.status(201).send({
        ok: true,
        data: {
          uploaded: true,
          image: safeName,
          size: stat.size,
          path: filePath,
        },
      });
    } catch (err) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "EEXIST") {
        return reply.status(409).send({
          ok: false,
          error: {
            code: "IMAGE_ALREADY_EXISTS",
            message: `Image ${safeName} already exists.`,
          },
        });
      }
      throw err;
    }
  });

  app.delete("/:imageName", async (req, reply) => {
    const { imageName } = req.params as { imageName: string };
    const safeName = normalizeImageName(imageName);
    if (!safeName) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "INVALID_IMAGE_NAME",
          message: 'Image filename must start with "I86BI_LINUX" or "I86BI_LINUX_L2".',
        },
      });
    }

    const filePath = path.join(CONFIG.iouDir, safeName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return reply.status(404).send({
        ok: false,
        error: {
          code: "IMAGE_NOT_FOUND",
          message: `Image ${safeName} not found.`,
        },
      });
    }

    fs.unlinkSync(filePath);
    return reply.send({
      ok: true,
      data: {
        deleted: true,
        image: safeName,
        path: filePath,
      },
    });
  });

  // IOU/IOL key (iourc)
  app.get("/key", async (_req, reply) => {
    const hostname = os.hostname();
    if (!fs.existsSync(CONFIG.iourc)) {
      return reply.send({ ok: true, data: { hostname, key: null } });
    }
    const content = fs.readFileSync(CONFIG.iourc, "utf8");
    const match = content.match(/^\s*\S+\s*=\s*(\S+)/m);
    return reply.send({ ok: true, data: { hostname, key: match?.[1] ?? null } });
  });

  app.put("/key", async (req, reply) => {
    const { key } = req.body as { key?: unknown };
    if (typeof key !== "string" || !/^\S+$/.test(key)) {
      return reply.status(400).send({
        ok: false,
        error: { code: "INVALID_KEY", message: "key must be a non-empty string without whitespace." },
      });
    }
    const hostname = os.hostname();
    fs.writeFileSync(CONFIG.iourc, `[license]\n${hostname} = ${key}\n`, "utf8");
    return reply.send({ ok: true, data: { hostname, key } });
  });

  app.get("/", async (req, reply) => {
    const { profile } = req.query as { profile?: string };

    if (profile && !SUPPORTED_PROFILES.has(profile)) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "INVALID_PROFILE",
          message: 'profile must be one of: "iouSwitch", "iouRouter"',
        },
      });
    }

    const images = fs
      .readdirSync(CONFIG.iouDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && matchesProfile(entry.name, profile))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    return reply.send({
      ok: true,
      data: {
        profile: profile ?? null,
        images,
      },
    });
  });
}

/** Local podman images, each with the catalog entry it matches (id + label only). */
export async function containerImageRoutes(app: FastifyInstance) {
  // The catalog is re-read per request; a broken file is reported, never papered over.
  function withCatalog(reply: FastifyReply, run: (catalog: ContainerCatalogEntry[]) => unknown) {
    let catalog: ContainerCatalogEntry[];
    try {
      catalog = loadContainerCatalog();
    } catch (err) {
      return reply.status(500).send({ ok: false, error: { code: getErrorCode(err) ?? "INTERNAL", message: (err as Error).message } });
    }
    return run(catalog);
  }

  app.get("/", async (_req, reply) => withCatalog(reply, (catalog) => {
    const images = listContainerImages().map((ref) => {
      const { id, label } = matchContainerCatalog(catalog, ref);
      return { ref, catalog: { id, label } };
    });
    return reply.send({ ok: true, data: { images } });
  }));

  // The full entry, fetched when an image is picked in the editor.
  app.get("/catalog/:id", async (req, reply) => withCatalog(reply, (catalog) => {
    const { id } = req.params as { id: string };
    const entry = catalog.find((e) => e.id === id);
    if (!entry) {
      return reply.status(404).send({ ok: false, error: { code: "CATALOG_ENTRY_NOT_FOUND", message: `No container catalog entry "${id}".` } });
    }
    const { match: _match, ...rest } = entry;
    return reply.send({ ok: true, data: rest });
  }));
}
