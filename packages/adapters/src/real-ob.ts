/**
 * 绑定真实的 `overlay-broadcast` 托管实现（REQ-DEP-004，core §16/§19）—— 它是 Mode B 门限组密钥
 * 与撤销注册表的来源。我们通过子进程驱动其预构建的 CLI（与 BSV 节点采用相同的模式）：
 * `custody keygen --threshold t --shares n` 生成一个真正的 t-of-n 门限组公钥（任何单一玩家都不持有
 * 完整私钥 —— Mode B），而 `custody revoke` 则演练真实的撤销路径。这不是满足一致性的 fake。
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const OB_DIR = process.env.BSV_OB_DIR ?? 'D:\\claude\\overlay-broadcast';
const OB_BIN = process.env.BSV_OB_BIN ?? join(OB_DIR, 'target', 'release', 'overlay-broadcast.exe');

function ob(args: string[]): string {
  return execFileSync(OB_BIN, args, { encoding: 'utf8' }).trim();
}

const SECP256K1_P = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f');

function modpow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

/** 若一个 33 字节 SEC-1 压缩公钥能解码为 secp256k1 上的真实点（y² = x³ + 7）则为 true。 */
export function isOnCurveCompressed(pub: Uint8Array): boolean {
  if (pub.length !== 33 || (pub[0] !== 0x02 && pub[0] !== 0x03)) return false;
  let x = 0n;
  for (let i = 1; i < 33; i++) x = (x << 8n) | BigInt(pub[i]!);
  if (x >= SECP256K1_P) return false;
  const rhs = (modpow(x, 3n, SECP256K1_P) + 7n) % SECP256K1_P;
  const y = modpow(rhs, (SECP256K1_P + 1n) / 4n, SECP256K1_P); // p ≡ 3 (mod 4)
  return (y * y) % SECP256K1_P === rhs;
}

export class RealOb {
  /** 一个真实的 t-of-n 门限组公钥（Mode B 托管密钥），33 字节压缩格式。 */
  thresholdGroupKey(threshold: number, shares: number): Uint8Array {
    const hex = ob(['custody', 'keygen', '--threshold', String(threshold), '--shares', String(shares)]);
    if (!/^[0-9a-f]{66}$/.test(hex)) throw new Error(`unexpected OB keygen output: ${hex}`);
    return Uint8Array.from(Buffer.from(hex, 'hex'));
  }

  /** 演练真实的撤销路径；返回该密钥是否已被撤销。 */
  revoke(): boolean {
    return ob(['custody', 'revoke']).includes('revoked=true');
  }

  /**
   * Mode B 在线门限签名：一个 t-of-n 法定人数在组密钥下对 `prehash`（一个 32 字节摘要）产生一个
   * 标准的 ECDSA（DER、low-S）签名 —— 组私钥绝不会被重构（GG20）。返回组公钥 + 签名。
   */
  thresholdSign(threshold: number, shares: number, prehash: Uint8Array): { groupKey: Uint8Array; sig: Uint8Array } {
    if (prehash.length !== 32) throw new Error('prehash must be 32 bytes');
    const out = ob(['custody', 'sign', '--threshold', String(threshold), '--shares', String(shares), '--message', Buffer.from(prehash).toString('hex')]);
    const m = out.match(/pubkey=([0-9a-f]{66})\s+sig=([0-9a-f]+)/);
    if (!m) throw new Error(`unexpected OB sign output: ${out}`);
    return { groupKey: Uint8Array.from(Buffer.from(m[1]!, 'hex')), sig: Uint8Array.from(Buffer.from(m[2]!, 'hex')) };
  }
}
