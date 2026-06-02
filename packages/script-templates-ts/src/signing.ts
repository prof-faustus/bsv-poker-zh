/**
 * 模板和解释器所使用的真实 secp256k1 密钥 + 签名辅助函数（core §6.7、
 * P9）。签名是对 SHA-256(preimage) 的真实 ECDSA（即解释器的 sighash 约定）。
 */

import {
  type KeyObject,
  generateKeyPairSync,
  sign as ecSign,
} from 'node:crypto';

export interface KeyPair {
  readonly priv: KeyObject;
  readonly pub: KeyObject;
  /** 33 字节的 SEC-1 压缩公钥。 */
  readonly pubCompressed: Uint8Array;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** 从公钥 KeyObject 的 JWK（x,y）得到压缩的 SEC-1 编码。 */
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

/**
 * 对 sighash preimage 进行签名；返回 LOW-S（BIP-62）的 DER ECDSA 签名——即 OP_CHECKSIG
 * 所验证的内容，也是 BSV 节点所要求的（它拒绝 high-S 签名）。
 */
export function signPreimage(preimage: Uint8Array, priv: KeyObject): Uint8Array {
  return normalizeLowS(new Uint8Array(ecSign('sha256', Buffer.from(preimage), priv)));
}

const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

function bytesToBig(b: Uint8Array): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}
function bigToMinimalBE(n: bigint): Uint8Array {
  const out: number[] = [];
  let x = n;
  while (x > 0n) {
    out.unshift(Number(x & 0xffn));
    x >>= 8n;
  }
  if (out.length === 0) out.push(0);
  if (out[0]! & 0x80) out.unshift(0x00); // DER 正整数符号字节
  return Uint8Array.from(out);
}
function derInt(b: Uint8Array): Uint8Array {
  return Uint8Array.from([0x02, b.length, ...b]);
}

/** 重新编码 DER ECDSA 签名，使 S 位于曲线阶的下半部（BIP-62）。 */
export function normalizeLowS(der: Uint8Array): Uint8Array {
  // DER：0x30 len 0x02 rlen <r> 0x02 slen <s>
  if (der[0] !== 0x30) return der;
  let i = 2;
  if (der[i] !== 0x02) return der;
  const rlen = der[i + 1]!;
  const r = der.slice(i + 2, i + 2 + rlen);
  i = i + 2 + rlen;
  if (der[i] !== 0x02) return der;
  const slen = der[i + 1]!;
  const s = der.slice(i + 2, i + 2 + slen);
  let sv = bytesToBig(s);
  if (sv > SECP256K1_N / 2n) sv = SECP256K1_N - sv;
  const rEnc = derInt(bigToMinimalBE(bytesToBig(r)));
  const sEnc = derInt(bigToMinimalBE(sv));
  const body = Uint8Array.from([...rEnc, ...sEnc]);
  return Uint8Array.from([0x30, body.length, ...body]);
}
