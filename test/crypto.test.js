import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encrypt,
  decrypt,
  DEFAULT_ITERATIONS,
  WrongPasswordError,
  MalformedBlobError,
} from "../dist/crypto.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (u) => new TextDecoder().decode(u);
const PW = "correct horse battery staple";
const MSG = "export default () => 'hello from the secret module';";

test("round-trips plaintext with the correct password", async () => {
  const blob = await encrypt(enc(MSG), PW, 50_000);
  const out = await decrypt(blob, PW);
  assert.equal(dec(out), MSG);
});

test("emits a self-describing LZEN v1 header", async () => {
  const blob = await encrypt(enc(MSG), PW, 12_345);
  assert.deepEqual([...blob.slice(0, 4)], [0x4c, 0x5a, 0x45, 0x4e]); // "LZEN"
  assert.equal(blob[4], 1); // version
  const iterations = new DataView(blob.buffer, blob.byteOffset).getUint32(5, false);
  assert.equal(iterations, 12_345); // runtime reads KDF params from the blob
});

test("wrong password throws WrongPasswordError", async () => {
  const blob = await encrypt(enc(MSG), PW);
  await assert.rejects(() => decrypt(blob, "nope"), WrongPasswordError);
});

test("uses fresh salt + iv per call (distinct ciphertext)", async () => {
  const a = await encrypt(enc(MSG), PW);
  const b = await encrypt(enc(MSG), PW);
  assert.notDeepEqual([...a], [...b]);
});

test("rejects a non-LZEN / truncated blob", async () => {
  await assert.rejects(() => decrypt(new Uint8Array(4), PW), MalformedBlobError);
  const blob = await encrypt(enc(MSG), PW);
  blob[0] = 0x00; // corrupt the magic
  await assert.rejects(() => decrypt(blob, PW), MalformedBlobError);
});

test("requires a password to encrypt", async () => {
  await assert.rejects(() => encrypt(enc(MSG), ""));
});

test("DEFAULT_ITERATIONS is exported and sane", () => {
  assert.ok(DEFAULT_ITERATIONS >= 100_000);
});
