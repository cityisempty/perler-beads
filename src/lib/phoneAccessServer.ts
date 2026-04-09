import 'server-only';

import { getRequestContext } from '@cloudflare/next-on-pages';

import {
  DEFAULT_PHONE_MAX_USES,
  isValidPhoneHash,
  isValidPhoneNumber,
  maskPhoneNumber,
  normalizePhoneNumber,
  type PhoneAccessSnapshot,
} from './phoneAccess';

const PHONE_ACCESS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS phone_access (
  phone TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL UNIQUE,
  total_uses INTEGER NOT NULL DEFAULT 10 CHECK (total_uses >= 0),
  used_uses INTEGER NOT NULL DEFAULT 0 CHECK (used_uses >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activated_at TEXT,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_phone_access_hash
ON phone_access(phone_hash);
`;

type PhoneAccessRow = {
  phone: string;
  phone_hash: string;
  total_uses: number;
  used_uses: number;
  created_at: string | null;
  updated_at: string | null;
  last_activated_at: string | null;
  last_used_at: string | null;
};

let schemaReady = false;

export class PhoneAccessError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PhoneAccessError';
    this.status = status;
  }
}

function getPhoneUsageDb(): D1Database {
  const { env } = getRequestContext();

  if (!env.PHONE_USAGE_DB) {
    throw new PhoneAccessError('未配置 Cloudflare D1 绑定 PHONE_USAGE_DB。', 500);
  }

  return env.PHONE_USAGE_DB;
}

async function ensurePhoneAccessSchema(db: D1Database): Promise<void> {
  if (schemaReady) {
    return;
  }

  await db.exec(PHONE_ACCESS_SCHEMA_SQL);
  schemaReady = true;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toSnapshot(row: PhoneAccessRow): PhoneAccessSnapshot {
  const maxUses = Math.max(0, Number(row.total_uses) || 0);
  const usageCount = Math.max(0, Number(row.used_uses) || 0);
  const remainingUses = Math.max(0, maxUses - usageCount);

  return {
    phoneHash: row.phone_hash,
    usageCount,
    maxUses,
    remainingUses,
    maskedPhone: maskPhoneNumber(row.phone),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivatedAt: row.last_activated_at,
    lastUsedAt: row.last_used_at,
  };
}

async function getPhoneAccessByPhoneValue(
  db: D1Database,
  phone: string
): Promise<PhoneAccessRow | null> {
  const row = await db
    .prepare(
      `SELECT phone, phone_hash, total_uses, used_uses, created_at, updated_at, last_activated_at, last_used_at
       FROM phone_access
       WHERE phone = ?
       LIMIT 1`
    )
    .bind(phone)
    .first<PhoneAccessRow>();

  return row ?? null;
}

async function getPhoneAccessByHashValue(
  db: D1Database,
  phoneHash: string
): Promise<PhoneAccessRow | null> {
  const row = await db
    .prepare(
      `SELECT phone, phone_hash, total_uses, used_uses, created_at, updated_at, last_activated_at, last_used_at
       FROM phone_access
       WHERE phone_hash = ?
       LIMIT 1`
    )
    .bind(phoneHash)
    .first<PhoneAccessRow>();

  return row ?? null;
}

function normalizeAndValidatePhone(rawPhone: string): string {
  const normalizedPhone = normalizePhoneNumber(rawPhone);

  if (!isValidPhoneNumber(normalizedPhone)) {
    throw new PhoneAccessError('请输入正确的手机号格式（11位数字，以1开头）', 400);
  }

  return normalizedPhone;
}

function normalizeAndValidatePhoneHash(rawHash: string): string {
  const normalizedHash = rawHash.trim().toLowerCase();

  if (!isValidPhoneHash(normalizedHash)) {
    throw new PhoneAccessError('手机号凭证无效，请重新输入手机号。', 400);
  }

  return normalizedHash;
}

export async function activatePhoneAccess(rawPhone: string): Promise<PhoneAccessSnapshot> {
  const phone = normalizeAndValidatePhone(rawPhone);
  const db = getPhoneUsageDb();
  await ensurePhoneAccessSchema(db);

  const now = new Date().toISOString();
  const phoneHash = await sha256Hex(phone);

  await db
    .prepare(
      `INSERT INTO phone_access (
         phone,
         phone_hash,
         total_uses,
         used_uses,
         created_at,
         updated_at,
         last_activated_at
       )
       VALUES (?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET
         phone_hash = excluded.phone_hash,
         updated_at = excluded.updated_at,
         last_activated_at = excluded.last_activated_at`
    )
    .bind(phone, phoneHash, DEFAULT_PHONE_MAX_USES, now, now, now)
    .run();

  const row = await getPhoneAccessByPhoneValue(db, phone);
  if (!row) {
    throw new PhoneAccessError('手机号记录创建失败，请稍后重试。', 500);
  }

  return toSnapshot(row);
}

export async function getPhoneAccessByPhone(rawPhone: string): Promise<PhoneAccessSnapshot> {
  const phone = normalizeAndValidatePhone(rawPhone);
  const db = getPhoneUsageDb();
  await ensurePhoneAccessSchema(db);

  const row = await getPhoneAccessByPhoneValue(db, phone);
  if (!row) {
    throw new PhoneAccessError('未找到该手机号的使用记录。', 404);
  }

  return toSnapshot(row);
}

export async function getPhoneAccessByHash(rawHash: string): Promise<PhoneAccessSnapshot> {
  const phoneHash = normalizeAndValidatePhoneHash(rawHash);
  const db = getPhoneUsageDb();
  await ensurePhoneAccessSchema(db);

  const row = await getPhoneAccessByHashValue(db, phoneHash);
  if (!row) {
    throw new PhoneAccessError('未找到该手机号的使用记录。', 404);
  }

  return toSnapshot(row);
}

export async function deductPhoneAccessByHash(rawHash: string): Promise<PhoneAccessSnapshot> {
  const phoneHash = normalizeAndValidatePhoneHash(rawHash);
  const db = getPhoneUsageDb();
  await ensurePhoneAccessSchema(db);

  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE phone_access
       SET used_uses = used_uses + 1,
           updated_at = ?,
           last_used_at = ?
       WHERE phone_hash = ?
         AND used_uses < total_uses`
    )
    .bind(now, now, phoneHash)
    .run();

  const row = await getPhoneAccessByHashValue(db, phoneHash);
  if (!row) {
    throw new PhoneAccessError('未找到该手机号的使用记录。', 404);
  }

  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (changes < 1) {
    if ((Number(row.used_uses) || 0) >= (Number(row.total_uses) || 0)) {
      throw new PhoneAccessError('该手机号已用完下载次数，请联系管理员续费。', 409);
    }

    throw new PhoneAccessError('扣减手机号次数失败，请稍后重试。', 500);
  }

  const updatedRow = await getPhoneAccessByHashValue(db, phoneHash);
  if (!updatedRow) {
    throw new PhoneAccessError('扣减完成后未找到手机号记录。', 500);
  }

  return toSnapshot(updatedRow);
}

export async function upsertPhoneRemainingUses(
  rawPhone: string,
  remainingUsesInput: number
): Promise<PhoneAccessSnapshot> {
  const phone = normalizeAndValidatePhone(rawPhone);
  const remainingUses = Number(remainingUsesInput);

  if (!Number.isInteger(remainingUses) || remainingUses < 0) {
    throw new PhoneAccessError('剩余次数必须是大于等于 0 的整数。', 400);
  }

  const db = getPhoneUsageDb();
  await ensurePhoneAccessSchema(db);

  const now = new Date().toISOString();
  const phoneHash = await sha256Hex(phone);
  const existing = await getPhoneAccessByPhoneValue(db, phone);

  if (existing) {
    const usedUses = Math.max(0, Number(existing.used_uses) || 0);
    const totalUses = usedUses + remainingUses;

    await db
      .prepare(
        `UPDATE phone_access
         SET phone_hash = ?,
             total_uses = ?,
             updated_at = ?
         WHERE phone = ?`
      )
      .bind(phoneHash, totalUses, now, phone)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO phone_access (
           phone,
           phone_hash,
           total_uses,
           used_uses,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, 0, ?, ?)`
      )
      .bind(phone, phoneHash, remainingUses, now, now)
      .run();
  }

  const row = await getPhoneAccessByPhoneValue(db, phone);
  if (!row) {
    throw new PhoneAccessError('更新手机号次数失败，请稍后重试。', 500);
  }

  return toSnapshot(row);
}
