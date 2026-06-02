/**
 * 绑定真实的 `revocable-nft-tee` 云端 TEE 实现（REQ-APP-230/231/240；core §2.4
 * 撤销 + §17 审计）—— TEE 证明 + 可撤销内容这一条线。我们通过子进程驱动其预构建的
 * `rnft-cli`（与 BSV 节点 / OB 采用相同的模式）：枚举 TEE 后端，并让完整的可撤销令牌生命周期
 * （mint → 成员访问 → revoke → 访问被拒 → 密钥销毁）针对由真实 enclave/CVM 支撑的参考驱动运行。
 * 这不是满足一致性的 fake。
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const TEE_DIR = process.env.BSV_TEE_DIR ?? 'D:\\claude\\revocable-nft-tee';
const TEE_BIN = process.env.BSV_TEE_BIN ?? join(TEE_DIR, 'target', 'release', 'rnft-cli.exe');

function tee(args: string[]): string {
  return execFileSync(TEE_BIN, args, { encoding: 'utf8' });
}

export interface TeeLifecycle {
  readonly tokenId: string;
  readonly memberAccess: boolean;
  readonly revokedDenied: boolean;
  readonly keyBurned: boolean;
}

export class RealTee {
  /** 本次构建固定可选用的 TEE 证明后端（SEV-SNP / TDX / SGX / HSM）。 */
  backends(): string[] {
    return tee(['backends'])
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim());
  }

  /** 通过真实的 TEE 驱动运行完整的可撤销令牌生命周期，并解析其结果。 */
  lifecycle(): TeeLifecycle {
    const out = tee(['demo']);
    const tokenId = /token_id\s*:\s*([0-9a-f]+)/.exec(out)?.[1] ?? '';
    return {
      tokenId,
      memberAccess: /member access\s*:\s*true/.test(out),
      revokedDenied: /revoked access\s*:\s*denied/.test(out),
      keyBurned: /content key burned:\s*true/.test(out),
    };
  }
}
