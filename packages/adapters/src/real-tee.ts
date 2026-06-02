/**
 * Binds the REAL `revocable-nft-tee` cloud-TEE implementation (REQ-APP-230/231/240; core §2.4
 * revocation + §17 audit) — the TEE attestation + revocable-content track. We drive its prebuilt
 * `rnft-cli` by subprocess (same pattern as the BSV node / OB): the TEE backends are enumerated and
 * the full revocable-token lifecycle (mint → member access → revoke → access denied → key burned)
 * runs against the real enclave/CVM-backed reference driver. Not a conformant fake.
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
  /** The selectable TEE attestation backends (SEV-SNP / TDX / SGX / HSM) the build pins. */
  backends(): string[] {
    return tee(['backends'])
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim());
  }

  /** Run the full revocable-token lifecycle through the real TEE driver and parse the outcome. */
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
