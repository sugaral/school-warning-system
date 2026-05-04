const COMMON_WEAK_PASSWORDS = new Set([
  '123456',
  '12345678',
  '123456789',
  '000000',
  '111111',
  '666666',
  '888888',
  '654321',
  '123123',
  'abc123',
  'qwerty',
  'password',
  'admin',
  'student',
  'iloveyou',
]);

export function normalizeMobile(value?: unknown): string | null {
  const mobile = String(value ?? '').trim();
  return mobile ? mobile : null;
}

export function isValidMainlandMobile(mobile: string): boolean {
  return /^1\d{10}$/.test(mobile);
}

function isSequentialDigits(password: string): boolean {
  if (!/^\d+$/.test(password)) {
    return false;
  }

  let asc = true;
  let desc = true;
  for (let i = 1; i < password.length; i += 1) {
    const prev = Number(password[i - 1]);
    const curr = Number(password[i]);
    if (curr !== (prev + 1) % 10) {
      asc = false;
    }
    if (curr !== (prev + 9) % 10) {
      desc = false;
    }
  }
  return asc || desc;
}

export function isWeakPassword(password?: unknown): boolean {
  const value = String(password ?? '').trim();
  if (value.length < 8) {
    return true;
  }
  if (COMMON_WEAK_PASSWORDS.has(value.toLowerCase())) {
    return true;
  }
  if (/^([a-zA-Z0-9])\1+$/.test(value)) {
    return true;
  }
  if (isSequentialDigits(value)) {
    return true;
  }

  const categoryCount =
    Number(/[a-z]/.test(value)) +
    Number(/[A-Z]/.test(value)) +
    Number(/\d/.test(value)) +
    Number(/[^a-zA-Z0-9]/.test(value));

  return categoryCount < 2;
}

export function generateStrongPassword(length = 12): string {
  const safeLength = Math.max(10, Math.min(32, Math.floor(length)));
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%*?';
  const all = upper + lower + digits + symbols;

  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
  const chars: string[] = [pick(upper), pick(lower), pick(digits), pick(symbols)];

  while (chars.length < safeLength) {
    chars.push(pick(all));
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
