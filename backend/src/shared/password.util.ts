import * as bcrypt from 'bcryptjs';

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;
const PASSWORD_SALT_ROUNDS = 10;

export function isBcryptHash(value?: string | null): boolean {
  return !!value && BCRYPT_HASH_PATTERN.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  storedPassword: string,
): Promise<boolean> {
  if (!storedPassword) {
    return false;
  }

  if (!isBcryptHash(storedPassword)) {
    return false;
  }

  return bcrypt.compare(password, storedPassword);
}
