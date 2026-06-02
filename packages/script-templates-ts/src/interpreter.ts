/**
 * 一个遵循 Genesis 规则的真实 BSV Script 栈解释器（core §6.2、§14.3、P9）。它执行
 * 实际的操作码流；签名检查使用真实的 secp256k1 ECDSA（Node crypto）。负向
 * 测试在该解释器内部失败（而非在包装层的防护中）——这是 P9 的义务。
 *
 * 此处编码的 Genesis 语义：
 *  - OP_CHECKLOCKTIMEVERIFY / OP_CHECKSEQUENCEVERIFY 为 NO-OP（REQ-TX-001）：它们既不消耗
 *    任何内容也不强制任何约束。时序在交易层面处理（REQ-TX-002）。
 *  - OP_RETURN 无论出现在何处都是无效的（core P11/§6.5）：脚本失败。
 *
 * TRACKED ASSUMPTION：这是该平台针对模板所使用的操作码子集的自包含解释器；
 * 此处的 sighash 是对 SHA-256(preimage) 的 ECDSA。生产环境切换到
 * 嵌入式节点的完整解释器（double-SHA-256 sighash、全部操作码）是后续步骤；
 * 届时模板测试将原封不动地针对它重新运行。
 */

import { createHash, createPublicKey, verify as ecVerify } from 'node:crypto';
import { OP } from './opcodes.ts';
import type { Script, ScriptItem } from './script.ts';

export interface ScriptContext {
  /** 被签名的消息（sighash preimage）；OP_CHECKSIG 对其 SHA-256 验证 ECDSA。 */
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
      // 负零（最后一字节为 0x80，其余为 0）为 false
      if (i === v.length - 1 && v[i] === 0x80) return false;
      return true;
    }
  }
  return false;
}

/** 从 33 字节的 SEC-1 压缩点重建 secp256k1 公钥 KeyObject。 */
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

/** 执行一段脚本（解锁脚本随后是锁定脚本，二者共享栈，legacy/Genesis 求值）。 */
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
  const exec: boolean[] = []; // IF/ELSE/ENDIF 执行标志
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
    // 即使不在执行状态，条件语句也会被求值（以跟踪嵌套）。
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
          // Genesis 之后为 NO-OP（REQ-TX-001）：不强制任何约束。
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
        case OP.OP_OVER: {
          const a = pop();
          const b = pop();
          stack.push(b, a, b);
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
        case OP.OP_SUB: {
          const b = num(pop());
          const a = num(pop());
          stack.push(encodeNum(a - b));
          break;
        }
        case OP.OP_MUL: {
          const a = num(pop());
          const b = num(pop());
          stack.push(encodeNum(a * b));
          break;
        }
        case OP.OP_MOD: {
          const b = num(pop());
          const a = num(pop());
          if (b === 0n) return { ok: false, reason: 'OP_MOD by zero' };
          // 欧几里得正模（此处的操作数为正的域值）。
          let r = a % b;
          if (r < 0n) r += b < 0n ? -b : b;
          stack.push(encodeNum(r));
          break;
        }
        case OP.OP_NUMEQUAL: {
          stack.push(num(pop()) === num(pop()) ? TRUE : FALSE);
          break;
        }
        case OP.OP_NUMEQUALVERIFY: {
          if (num(pop()) !== num(pop())) return { ok: false, reason: 'OP_NUMEQUALVERIFY failed' };
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
          const n = Number(num(pop()));
          const pubs: Uint8Array[] = [];
          for (let i = 0; i < n; i++) pubs.push(pop());
          const m = Number(num(pop()));
          const sigs: Uint8Array[] = [];
          for (let i = 0; i < m; i++) sigs.push(pop());
          pop(); // 额外的元素（legacy CHECKMULTISIG bug，予以保留）
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

/** m-of-n：每个签名必须匹配一个不同的公钥，且按公钥顺序匹配（Bitcoin 语义）。 */
function checkMultisig(sigs: Uint8Array[], pubs: Uint8Array[], ctx: ScriptContext): boolean {
  // sigs 是逆序弹出的；恢复其签名顺序。
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

/**
 * Script 数值解码——小端、符号-数值表示、ARBITRARY PRECISION（Genesis 之后的 BSV
 * 移除了 4 字节的 CScriptNum 上限），以 BigInt 表示。脚本内 EC 公平博弈（§19.C）所需的
 * 256 位域运算依赖于此。
 */
function num(v: Uint8Array): bigint {
  if (v.length === 0) return 0n;
  const bytes = [...v];
  const last = bytes.length - 1;
  let neg = false;
  if ((bytes[last]! & 0x80) !== 0) {
    neg = true;
    bytes[last] = bytes[last]! & 0x7f;
  }
  let r = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) r = (r << 8n) | BigInt(bytes[i]!);
  return neg ? -r : r;
}
function encodeNum(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array(0);
  const neg = n < 0n;
  let x = neg ? -n : n;
  const out: number[] = [];
  while (x > 0n) {
    out.push(Number(x & 0xffn));
    x >>= 8n;
  }
  if ((out[out.length - 1]! & 0x80) !== 0) out.push(neg ? 0x80 : 0x00);
  else if (neg) out[out.length - 1] = out[out.length - 1]! | 0x80;
  return Uint8Array.from(out);
}

function hash(algo: 'sha256' | 'ripemd160', data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash(algo).update(Buffer.from(data)).digest());
}
