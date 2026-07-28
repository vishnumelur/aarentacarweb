import { hash, verify } from '@node-rs/argon2'

/**
 * NFR-3 requires Argon2id. The defaults in @node-rs/argon2 follow the OWASP
 * recommendation; they are not tuned down for speed.
 */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain)
}

/**
 * Returns false for a malformed stored hash rather than throwing. A corrupt row must
 * fail the login, not crash the endpoint for every other user.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain)
  } catch {
    return false
  }
}
