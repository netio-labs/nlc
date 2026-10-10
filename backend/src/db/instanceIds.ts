import { and, asc, eq, isNull, isNotNull, sql, count } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { db, sqlite } from "./db.ts";
import { appError } from "../services/errors.ts";

export const iouInstancePool = sqliteTable("iou_instance_pool", {
  instanceId: integer("instance_id").primaryKey(),
  labId: text("lab_id"),
  nodeId: text("node_id"),
  allocatedAt: text("allocated_at"),
  updatedAt: text("updated_at"),
});

let poolReady = false;

function ensurePool(): void {
  if (poolReady) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS iou_instance_pool (
      instance_id INTEGER PRIMARY KEY,
      lab_id TEXT,
      node_id TEXT,
      allocated_at TEXT,
      updated_at TEXT
    )
  `);
  const result = db.select({ count: count() }).from(iouInstancePool).get();
  if (result?.count === 0) {
    const rows = Array.from({ length: 1023 }, (_, idx) => ({
      instanceId: idx + 1,
    }));
    // { length: 1023 } creates an array with 1023 empty slots, so we use map to fill them with actual objects
    db.insert(iouInstancePool).values(rows).run();
  }
  poolReady = true;
}

export function ensureInstanceId(labId: string, nodeId: string): number {
  ensurePool();
  return db.transaction((tx) => {
    const existing = tx
      .select({ instanceId: iouInstancePool.instanceId })
      .from(iouInstancePool)
      .where(and(eq(iouInstancePool.labId, labId), eq(iouInstancePool.nodeId, nodeId)))
      .get();
    if (existing?.instanceId) {
      tx.update(iouInstancePool)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(iouInstancePool.instanceId, existing.instanceId))
        .run();
      return existing.instanceId;
    }

    const free = tx
      .select({ instanceId: iouInstancePool.instanceId })
      .from(iouInstancePool)
      .where(isNull(iouInstancePool.labId))
      .orderBy(asc(iouInstancePool.instanceId))
      .limit(1)
      .get();

    if (!free?.instanceId) {
      throw appError("NO_FREE_INSTANCE_ID", "No available IOU instance IDs");
    }

    const now = new Date().toISOString();
    tx.update(iouInstancePool)
      .set({
        labId,
        nodeId,
        allocatedAt: now,
        updatedAt: now,
      })
      .where(eq(iouInstancePool.instanceId, free.instanceId))
      .run();
    return free.instanceId;
  });
}

export function ensureLabInstanceIds(labId: string, nodeIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const nodeId of nodeIds) {
    map.set(nodeId, ensureInstanceId(labId, nodeId));
  }
  return map;
}

export function getInstanceId(labId: string, nodeId: string): number | null {
  ensurePool();
  const row = db
    .select({ instanceId: iouInstancePool.instanceId })
    .from(iouInstancePool)
    .where(and(eq(iouInstancePool.labId, labId), eq(iouInstancePool.nodeId, nodeId)))
    .get();
  return row?.instanceId ?? null;
}

export function listLabInstanceIds(labId: string): number[] {
  ensurePool();
  const rows = db
    .select({ instanceId: iouInstancePool.instanceId })
    .from(iouInstancePool)
    .where(eq(iouInstancePool.labId, labId))
    .orderBy(asc(iouInstancePool.instanceId))
    .all();
  return rows.map((row) => row.instanceId);
}

export function requireInstanceId(labId: string, nodeId: string): number {
  const instanceId = getInstanceId(labId, nodeId);
  if (!instanceId) {
    throw appError("LAB_NOT_LOADED", "Lab not loaded; instance id not allocated.");
  }
  return instanceId;
}

export function listAllAllocatedInstances(): { labId: string; instanceId: number }[] {
  ensurePool();
  const rows = db
    .select({ labId: iouInstancePool.labId, instanceId: iouInstancePool.instanceId })
    .from(iouInstancePool)
    .where(isNotNull(iouInstancePool.labId))
    .orderBy(asc(iouInstancePool.instanceId))
    .all();
  return rows.map((r) => ({ labId: r.labId!, instanceId: r.instanceId }));
}

export function releaseLabInstances(labId: string): number {
  ensurePool();
  const now = new Date().toISOString();
  const result = db
    .update(iouInstancePool)
    .set({ labId: null, nodeId: null, updatedAt: now })
    .where(eq(iouInstancePool.labId, labId))
    .run();
  return result.changes ?? 0;
}
