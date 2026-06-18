/**
 * Shared crypto + binary format for lazy-encrypt.
 *
 * Used on both sides of the boundary:
 *   - the Vite plugin (Node) calls `encrypt()` at build time,
 *   - the React runtime (browser) calls `decrypt()` at unlock time.
 *
 * Both rely only on the WebCrypto API (`globalThis.crypto.subtle`), which is
 * available in browsers and in Node >= 16, so this module has no Node-specific
 * imports and ships to the client unchanged.
 *
 * File format ("LZEN" v1) — the encrypted blob is self-describing, so the
 * runtime never has to be told the KDF parameters out of band:
 *
 *   offset  size  field
 *   ------  ----  -----------------------------------------------
 *        0     4  magic        ASCII "LZEN"  (0x4C 0x5A 0x45 0x4E)
 *        4     1  version      currently 1
 *        5     4  iterations   PBKDF2 iteration count, uint32 big-endian
 *        9    16  salt         PBKDF2 salt
 *       25    12  iv           AES-GCM nonce
 *       37   ...  ciphertext   AES-GCM(plaintext) incl. 16-byte auth tag
 */

const MAGIC = Uint8Array.from([0x4c, 0x5a, 0x45, 0x4e]); // "LZEN"
const VERSION = 1;
const HEADER_LEN = 4 + 1 + 4 + 16 + 12; // 37

/** Default PBKDF2 iteration count. Tunable per build via the plugin option. */
export const DEFAULT_ITERATIONS = 250_000;

/** Thrown when the blob is missing, truncated, or not a valid LZEN container. */
export class MalformedBlobError extends Error {}

/** Thrown when AES-GCM authentication fails — i.e. the password is wrong. */
export class WrongPasswordError extends Error {}

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error(
      "WebCrypto (globalThis.crypto.subtle) is unavailable in this environment.",
    );
  }
  return c.subtle;
};

function randomBytes(len: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(len));
}

// TS 5.7+ made `Uint8Array` generic over its backing buffer, while WebCrypto's
// `BufferSource` requires an `ArrayBuffer`-backed view. Our buffers always are,
// so narrow them at the API boundary rather than threading generics everywhere.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const base = await subtle().importKey(
    "raw",
    bs(new TextEncoder().encode(password)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt: bs(salt), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/**
 * Encrypt `plaintext` with `password`, returning a complete LZEN blob.
 * A fresh random salt and IV are generated per call.
 */
export async function encrypt(
  plaintext: Uint8Array,
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<Uint8Array> {
  if (!password) throw new Error("encrypt(): password is required.");
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("encrypt(): iterations must be a positive integer.");
  }

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, iterations, "encrypt");
  const ct = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(plaintext)),
  );

  const out = new Uint8Array(HEADER_LEN + ct.length);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  view.setUint32(5, iterations, false); // big-endian
  out.set(salt, 9);
  out.set(iv, 25);
  out.set(ct, HEADER_LEN);
  return out;
}

/**
 * Decrypt an LZEN blob with `password`.
 * @throws {MalformedBlobError} if the container is not valid LZEN v1.
 * @throws {WrongPasswordError} if authentication fails (wrong password).
 */
export async function decrypt(
  blob: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  if (blob.length < HEADER_LEN) {
    throw new MalformedBlobError("blob too short to be a valid LZEN container.");
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) {
      throw new MalformedBlobError("bad magic — not an LZEN container.");
    }
  }
  const version = blob[4];
  if (version !== VERSION) {
    throw new MalformedBlobError(`unsupported LZEN version ${version}.`);
  }

  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const iterations = view.getUint32(5, false);
  const salt = blob.slice(9, 25);
  const iv = blob.slice(25, 37);
  const data = blob.slice(37);

  const key = await deriveKey(password, salt, iterations, "decrypt");
  try {
    return new Uint8Array(
      await subtle().decrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(data)),
    );
  } catch {
    // AES-GCM auth-tag mismatch is the only expected failure here.
    throw new WrongPasswordError("decryption failed (wrong password).");
  }
}
