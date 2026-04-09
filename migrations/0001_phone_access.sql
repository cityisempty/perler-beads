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
