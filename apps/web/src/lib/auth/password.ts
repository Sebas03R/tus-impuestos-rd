import "server-only";
import { verify } from "@node-rs/argon2";

/** Verifica hashes argon2id en formato PHC (los genera `tirds admin create` con argon2-cffi). */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await verify(hash, password);
  } catch {
    return false;
  }
}
