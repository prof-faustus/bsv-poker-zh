/**
 * Real secp256k1 key + signature helpers used by the templates and the interpreter (core §6.7,
 * P9). Signatures are real ECDSA over SHA-256(preimage) (the interpreter's sighash convention).
 */

import {
  type KeyObject,
  generateKeyPairSync,
  sign as ecSign,
} from 'node:crypto';

export interface KeyPair {
  readonly priv: KeyObject;
  readonly pub: KeyObject;
  /** 33-byte SEC-1 compressed public key. */
  readonly pubCompressed: Uint8Array;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Compressed SEC-1 encoding from a public KeyObject's JWK (x,y). */
export function compressedPub(pub: KeyObject): Uint8Array {
  const jwk = pub.export({ format: 'jwk' }) as { x?: string; y?: string };
  if (!jwk.x || !jwk.y) throw new Error('not an EC public key');
  const x = b64urlToBytes(jwk.x);
  const y = b64urlToBytes(jwk.y);
  const x32 = new Uint8Array(32);
  x32.set(x, 32 - x.length);
  const prefix = (y[y.length - 1]! & 1) === 0 ? 0x02 : 0x03;
  const out = new Uint8Array(33);
  out[0] = prefix;
  out.set(x32, 1);
  return out;
}

export function genKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return { priv: privateKey, pub: publicKey, pubCompressed: compressedPub(publicKey) };
}

/** Sign a sighash preimage; returns a DER ECDSA signature (what OP_CHECKSIG verifies). */
export function signPreimage(preimage: Uint8Array, priv: KeyObject): Uint8Array {
  return new Uint8Array(ecSign('sha256', Buffer.from(preimage), priv));
}
