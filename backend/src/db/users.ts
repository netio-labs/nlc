import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { db, sqlite } from "./db.ts";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "changeme";

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const hash = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, salt, hash.length);
  return derived.length === hash.length && timingSafeEqual(derived, hash);
}

let usersReady = false;

function ensureUsersTable(): void {
  if (usersReady) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  usersReady = true;

  const existing = db.select({ id: users.id }).from(users).limit(1).get();
  if (!existing) {
    const now = new Date().toISOString();
    db.insert(users)
      .values({
        id: crypto.randomUUID(),
        username: DEFAULT_USERNAME,
        passwordHash: hashPassword(DEFAULT_PASSWORD),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

function getUserByUsername(username: string): UserRecord | null {
  ensureUsersTable();
  return (
    db
      .select({
        id: users.id,
        username: users.username,
        passwordHash: users.passwordHash,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.username, username))
      .get() ?? null
  );
}

export function verifyUserPassword(username: string, password: string): boolean {
  const user = getUserByUsername(username);
  if (!user) return false;
  return verifyPassword(password, user.passwordHash);
}

export function updateUserPassword(username: string, newPassword: string): number {
  ensureUsersTable();
  const result = db
    .update(users)
    .set({
      passwordHash: hashPassword(newPassword),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.username, username))
    .run();
  return result.changes ?? 0;
}
