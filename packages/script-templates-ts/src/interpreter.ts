/**
 * A real BSV Script stack interpreter with Genesis rules (core §6.2, §14.3, P9). It executes
 * the actual opcode stream; signature checks use REAL secp256k1 ECDSA (Node crypto). Negative
 * tests fail INSIDE this interpreter (not in a wrapper guard) — that is the P9 obligation.
 *
 * Genesis semantics encoded here:
 *  - OP_CHECKLOCKTIMEVERIFY / OP_CHECKSEQUENCEVERIFY are NO-OPS (REQ-TX-001): they consume
 *    nothing and enforce nothing. Timing is transaction-level (REQ-TX-002).
 *  - OP_RETURN is invalid wherever it appears (core P11/§6.5): the script fails.
 *
 * TRACKED ASSUMPTION: this is the platform's self-contained interpreter for the opcode subset
 * the templates use; sighash here is ECDSA over SHA-256(preimage). A production swap to the
 * embedded node's full interpreter (double-SHA-256 sighash, every opcode) is a later step; the
 * template tests then re-run against it unchanged.
 */

import { createHash, createPublicKey, verify as ecVerify } from 'node:crypto';
import { OP } from './opcodes.ts';
import type { Script, ScriptItem } from './script.ts';

export interface ScriptContext {
  /** The signed message (sighash preimage); OP_CHECKSIG verifies ECDSA over SHA-256 of this. */
  readonly sighashPreimage: Uint8Array;
}

export interface EvalResult {
  readonly ok: boolean;
  readonly reason?: string;
}

type Stack = Uint8Array[];

const TRUE = Uint8Array.of(1);
const FALSE = new Uint8Array(0);

function isTruthy(v: Uint8Array): boolean {
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== 0) {
      // negative zero (0x80 as last byte, rest 0) is false
      if (i === v.length - 1 && v[i] === 0x80) return false;
      return true;
    }
  }
  return false;
}

/** Reconstruct a secp256k1 public KeyObject from a 33-byte SEC-1 compressed point. */
function compressedToKey(pub: Uint8Array): ReturnType<typeof createPublicKey> {
  if (pub.length !== 33 || (pub[0] !== 0x02 && pub[0] !== 0x03)) {
    throw new Error('not a compressed secp256k1 point');
  }
  const prefix = Uint8Array.from([
    0x30, 0x36, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05,
    0x2b, 0x81, 0x04, 0x00, 0x0a, 0x03, 0x22, 0x00,
  ]);
  const der = new Uint8Array(prefix.length + pub.length);
  der.set(prefix, 0);
  der.set(pub, prefix.length);
  return createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' });
}

function checkSig(sig: Uint8Array, pub: Uint8Array, ctx: ScriptContext): boolean {
  if (sig.length === 0) return false;
  try {
    const key = compressedToKey(pub);
    return ecVerify('sha256', Buffer.from(ctx.sighashPreimage), key, Buffer.from(sig));
  } catch {
    return false;
  }
}

/** Execute one script (unlocking then locking share the stack, legacy/Genesis evaluation). */
export function evaluate(unlocking: Script, locking: Script, ctx: ScriptContext): EvalResult {
  const stack: Stack = [];
  for (const phase of [unlocking, locking]) {
    const r = run(phase, stack, ctx);
    if (!r.ok) return r;
  }
  if (stack.length === 0) return { ok: false, reason: 'empty stack' };
  return { ok: isTruthy(stack[stack.length - 1]!), reason: 'top not truthy' };
}

function run(script: Script, stack: Stack, ctx: ScriptContext): EvalResult {
  const exec: boolean[] = []; // IF/ELSE/ENDIF execution flags
  const executing = (): boolean => exec.every((x) => x);
  const pop = (): Uint8Array => {
    const v = stack.pop();
    if (v === undefined) throw new Error('stack underflow');
    return v;
  };

  for (const item of script as ScriptItem[]) {
    if (typeof item !== 'number') {
      if (executing()) stack.push(item);
      continue;
    }
    // Conditionals are evaluated even when not executing (to track nesting).
    if (item === OP.OP_IF) {
      exec.push(executing() ? isTruthy(pop()) : false);
      continue;
    }
    if (item === OP.OP_ELSE) {
      if (exec.length === 0) return { ok: false, reason: 'OP_ELSE without OP_IF' };
      exec[exec.length - 1] = !exec[exec.length - 1] && exec.slice(0, -1).every((x) => x);
      continue;
    }
    if (item === OP.OP_ENDIF) {
      if (exec.length === 0) return { ok: false, reason: 'OP_ENDIF without OP_IF' };
      exec.pop();
      continue;
    }
    if (!executing()) continue;

    try {
      switch (item) {
        case OP.OP_RETURN:
          return { ok: false, reason: 'OP_RETURN is banned (core P11/§6.5)' };
        case OP.OP_CHECKLOCKTIMEVERIFY:
        case OP.OP_CHECKSEQUENCEVERIFY:
          // NO-OP post-Genesis (REQ-TX-001): enforce nothing.
          break;
        case OP.OP_0:
          stack.push(FALSE);
          break;
        case OP.OP_1:
          stack.push(Uint8Array.of(1));
          break;
        case OP.OP_2:
          stack.push(Uint8Array.of(2));
          break;
        case OP.OP_3:
          stack.push(Uint8Array.of(3));
          break;
        case OP.OP_DUP: {
          const v = pop();
          stack.push(v, v);
          break;
        }
        case OP.OP_DROP:
          pop();
          break;
        case OP.OP_SWAP: {
          const a = pop();
          const b = pop();
          stack.push(a, b);
          break;
        }
        case OP.OP_EQUAL: {
          const a = pop();
          const b = pop();
          stack.push(eq(a, b) ? TRUE : FALSE);
          break;
        }
        case OP.OP_EQUALVERIFY: {
          const a = pop();
          const b = pop();
          if (!eq(a, b)) return { ok: false, reason: 'OP_EQUALVERIFY failed' };
          break;
        }
        case OP.OP_VERIFY:
          if (!isTruthy(pop())) return { ok: false, reason: 'OP_VERIFY failed' };
          break;
        case OP.OP_SHA256:
          stack.push(hash('sha256', pop()));
          break;
        case OP.OP_HASH256:
          stack.push(hash('sha256', hash('sha256', pop())));
          break;
        case OP.OP_HASH160:
          stack.push(hash('ripemd160', hash('sha256', pop())));
          break;
        case OP.OP_ADD: {
          const a = num(pop());
          const b = num(pop());
          stack.push(encodeNum(a + b));
          break;
        }
        case OP.OP_CHECKSIG: {
          const pub = pop();
          const sig = pop();
          stack.push(checkSig(sig, pub, ctx) ? TRUE : FALSE);
          break;
        }
        case OP.OP_CHECKSIGVERIFY: {
          const pub = pop();
          const sig = pop();
          if (!checkSig(sig, pub, ctx)) return { ok: false, reason: 'OP_CHECKSIGVERIFY failed' };
          break;
        }
        case OP.OP_CHECKMULTISIG: {
          const n = num(pop());
          const pubs: Uint8Array[] = [];
          for (let i = 0; i < n; i++) pubs.push(pop());
          const m = num(pop());
          const sigs: Uint8Array[] = [];
          for (let i = 0; i < m; i++) sigs.push(pop());
          pop(); // the extra element (legacy CHECKMULTISIG bug, retained)
          stack.push(checkMultisig(sigs, pubs, ctx) ? TRUE : FALSE);
          break;
        }
        default:
          return { ok: false, reason: `unsupported opcode 0x${item.toString(16)}` };
      }
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }
  if (exec.length !== 0) return { ok: false, reason: 'unbalanced OP_IF' };
  return { ok: true };
}

/** m-of-n: each sig must match a distinct pubkey, in pubkey order (Bitcoin semantics). */
function checkMultisig(sigs: Uint8Array[], pubs: Uint8Array[], ctx: ScriptContext): boolean {
  // sigs were popped in reverse; restore signing order.
  const orderedSigs = [...sigs].reverse();
  const orderedPubs = [...pubs].reverse();
  let si = 0;
  for (let pi = 0; pi < orderedPubs.length && si < orderedSigs.length; pi++) {
    if (checkSig(orderedSigs[si]!, orderedPubs[pi]!, ctx)) si++;
  }
  return si === orderedSigs.length;
}

function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function num(v: Uint8Array): number {
  // minimal little-endian script number
  let n = 0;
  for (let i = 0; i < v.length; i++) n |= v[i]! << (8 * i);
  return n;
}
function encodeNum(n: number): Uint8Array {
  if (n === 0) return new Uint8Array(0);
  const out: number[] = [];
  let x = n;
  while (x > 0) {
    out.push(x & 0xff);
    x >>= 8;
  }
  return Uint8Array.from(out);
}

function hash(algo: 'sha256' | 'ripemd160', data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash(algo).update(Buffer.from(data)).digest());
}
