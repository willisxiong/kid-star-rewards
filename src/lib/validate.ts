export function parseName(value: unknown, max = 40): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\r\n]+/g, ' ').trim();
  if (!name || name.length > max) return null;
  return name;
}

export function parsePoints(value: unknown, max = 999): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > max) return null;
  return numeric;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return null;
  return email;
}

export function normalizeFamilyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,16}$/.test(code)) return null;
  return code;
}
