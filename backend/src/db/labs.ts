import { count, desc, eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { db, sqlite } from "./db.ts";

export const labs = sqliteTable("labs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type LabRecord = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

let labsReady = false;

function ensureLabsTable(): void {
  if (labsReady) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS labs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  labsReady = true;
}

export function getAllLabs(limit = 100, offset = 0, view = "update"): { labs: LabRecord[]; total: number } {
  ensureLabsTable();
  const total = db.select({ total: count() }).from(labs).get()?.total ?? 0;
  const orderBy = view === "create" ? desc(labs.createdAt) : desc(labs.updatedAt);
  const rows = db
    .select({
      id: labs.id,
      name: labs.name,
      description: labs.description,
      createdAt: labs.createdAt,
      updatedAt: labs.updatedAt,
    })
    .from(labs)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)
    .all();
  return { labs: rows, total };
}

export function getLabById(labId: string): LabRecord | null {
  ensureLabsTable();
  return (
    db
      .select({
        id: labs.id,
        name: labs.name,
        description: labs.description,
        createdAt: labs.createdAt,
        updatedAt: labs.updatedAt,
      })
      .from(labs)
      .where(eq(labs.id, labId))
      .get() ?? null
  );
}

export function createLab(input: { id: string; name: string; description?: string }): void {
  ensureLabsTable();
  const now = new Date().toISOString();
  db.insert(labs)
    .values({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function updateLab(input: { id: string; name: string; description?: string }): number {
  ensureLabsTable();
  const result = db
    .update(labs)
    .set({
      name: input.name,
      description: input.description ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(labs.id, input.id))
    .run();
  return result.changes ?? 0;
}

export function deleteLab(labId: string): number {
  ensureLabsTable();
  const result = db.delete(labs).where(eq(labs.id, labId)).run();
  return result.changes ?? 0;
}
