/**
 * 钱包托管（core §9）。每个玩家拥有一个长期 secp256k1 密钥；每局/每张牌的标量
 * 通过绑定到 (gid, j[, role]) 的 HKDF 确定性派生 —— REQ-WALLET-001/002：设备
 * 只存储一个密钥，派生是确定性且可审计的，旧对局的密钥不泄露任何信息。
 *
 * Custody 接口（REQ-WALLET-003）抽象了密钥存放位置以及签名发生的地方；
 * 默认的软件后端将密钥保存在进程内，除查看者路径外绝不向 UI 暴露标量。
 * Mode A（Phase 1 默认，core §4.3/§9.3）：每张牌的标量是单局的，
 * `reconstructAndSign` 会对披露的标量求和以签署组合密钥花费；Mode B 的
 * `combineSignShare` 存在于接口中，但软件后端将其标记为不支持。
 */

import {
  type KeyObject,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
} from 'node:crypto';
import { bytesToHex } from '@bsv-poker/protocol-types';
import { compressedPub, signPreimage } from '@bsv-poker/script-templates-ts';

export interface SignIntent {
  /** 正在签名的确切字节（sighash preimage）。 */
  readonly sighashPreimage: Uint8Array;
  /** 在签名提示中展示的人类可读描述（不静默签名，§11.6）。 */
  readonly describe: { action: string; amounts?: string; potOrState?: string };
}

export interface Custody {
  /** 为 (gid, j, role) 派生的 HKDF 公钥；绝不返回标量（REQ-APP-025）。 */
  derive(gid: string, j: number, role: string): string; // 压缩格式 pubkey hex
  /** 用 (gid,j,role) 密钥精确签署 intent 的字节。 */
  sign(gid: string, j: number, role: string, intent: SignIntent): Uint8Array;
  /** 将一张隐藏的牌解密进受控的查看者路径（返回一个查看者令牌）。 */
  decryptToViewer(commitmentHex: string): string;
  /** Mode B 门限份额（core §6.7）；软件后端不支持。 */
  combineSignShare(): never;
  /** Mode A（core §4.3）：重建 w_j = Σ 标量并签名（受限作用域、单局、可审计）。 */
  reconstructAndSign?(scalars: readonly Uint8Array[], intent: SignIntent): Uint8Array;
}

/** secp256k1 群的阶 n。 */
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

/** 从一个 32 字节标量 `d` 构造一个 secp256k1 的 PKCS8 DER 私钥。 */
export function scalarToPrivateKey(d: Uint8Array): KeyObject {
  if (d.length !== 32) throw new Error('scalar must be 32 bytes');
  const ecPrivateKey = Uint8Array.from([0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20, ...d]);
  const algId = Uint8Array.from([
    0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81,
    0x04, 0x00, 0x0a,
  ]);
  const inner = Uint8Array.from([0x04, ecPrivateKey.length, ...ecPrivateKey]);
  const body = Uint8Array.from([0x02, 0x01, 0x00, ...algId, ...inner]);
  const der = Uint8Array.from([0x30, body.length, ...body]);
  return createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
}

/** 从主密钥 + info 确定性地派生一个有效的 secp256k1 标量（位于 [1, n-1]）。 */
function deriveScalar(master: Uint8Array, info: string): Uint8Array {
  for (let salt = 0; salt < 256; salt++) {
    const out = new Uint8Array(
      hkdfSync('sha256', Buffer.from(master), Buffer.alloc(0), `${info}:${salt}`, 32) as ArrayBuffer,
    );
    let v = 0n;
    for (const b of out) v = (v << 8n) | BigInt(b);
    if (v >= 1n && v < N) return out;
  }
  throw new Error('could not derive a valid scalar');
}

/** 软件托管后端（默认，AD7）。在进程内持有一个主密钥。 */
export function createSoftwareCustody(masterKey: Uint8Array): Custody {
  if (masterKey.length < 16) throw new Error('master key too short');
  const cache = new Map<string, KeyObject>();

  function priv(gid: string, j: number, role: string): KeyObject {
    const key = `${gid}:${j}:${role}`;
    let k = cache.get(key);
    if (!k) {
      k = scalarToPrivateKey(deriveScalar(masterKey, key));
      cache.set(key, k);
    }
    return k;
  }

  return {
    derive(gid, j, role) {
      const pub = createPublicKey(priv(gid, j, role));
      return bytesToHex(compressedPub(pub));
    },
    sign(gid, j, role, intent) {
      return signPreimage(intent.sighashPreimage, priv(gid, j, role));
    },
    decryptToViewer(commitmentHex) {
      // 查看者路径占位实现：渲染出的牌面绝不以原始密钥材料的形式离开此边界。
      return `viewer:${commitmentHex.slice(0, 16)}`;
    },
    combineSignShare(): never {
      throw new Error('software custody does not support Mode B threshold signing (use OB.custody)');
    },
    reconstructAndSign(scalars, intent) {
      // Mode A：w_j = Σ s_{p,j} mod n；用重建出的组合密钥签名（core §4.3）。
      let w = 0n;
      for (const s of scalars) {
        let v = 0n;
        for (const b of s) v = (v << 8n) | BigInt(b);
        w = (w + v) % N;
      }
      if (w === 0n) throw new Error('combined scalar is zero');
      const d = new Uint8Array(32);
      let x = w;
      for (let i = 31; i >= 0; i--) {
        d[i] = Number(x & 0xffn);
        x >>= 8n;
      }
      return signPreimage(intent.sighashPreimage, scalarToPrivateKey(d));
    },
  };
}
