export const DEFAULT_PHONE_MAX_USES = 10;

export type PhoneAccessSnapshot = {
  phoneHash: string;
  usageCount: number;
  maxUses: number;
  remainingUses: number;
  maskedPhone: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivatedAt: string | null;
  lastUsedAt: string | null;
};

export function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

export function isValidPhoneNumber(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

export function isValidPhoneHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash.trim().toLowerCase());
}

export function maskPhoneNumber(phone: string): string {
  if (phone.length !== 11) {
    return phone;
  }

  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}
