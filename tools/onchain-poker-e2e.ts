/**
 * 针对真实 BSV 节点的链上扑克结算 E2E（core §6.6）。平台自有的扑克
 * 模板把一手牌结算为真实已确认的交易：
 *   1. 向某个密钥挖出一个 coinbase；
 *   2. FUNDING tx：把 coinbase 花费进一个 N-of-N 多签“底池”输出（funding 模板，
 *      绑定到 gid+rulesetHash）——节点接受并挖入；
 *   3. SETTLEMENT tx：通过 settlement 解锁把底池（funding 多签）花费给赢家
 *      ——节点接受并挖入；
 *   4. 确认：底池已被花费，赢家的输出是一个已确认的 UTXO。
 * 这展示了通过真实 interpreter 在链上的实际扑克资金流。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import assert from 'node:assert/strict';
import { RealBsvNode } from '@bsv-poker/adapters/real-node';
import {
  OP,
  genKeyPair,
  signPreimage,
  fairPlayCommitment,
  fundingLocking,
  fundingUnlocking,
  type Script,
  type KeyPair,
} from '@bsv-poker/script-templates-ts';
import { bytesToHex, type BranchBinding } from '@bsv-poker/protocol-types';
import { type Tx, serializeTxWire, txidWire, sighashMessage, SIGHASH_ALL_FORKID } from '@bsv-poker/tx-builder';

const NODE_DIR = process.env.BSV_NODE_DIR ?? 'D:\\claude\\ACM 01\\bonded-subsat-channel';
const PORT = Number(process.env.BSV_NODE_PORT ?? 8744);
const SUBSIDY = 5_000_000_000;
let daemon: ChildProcess | null = null;

const BIND: BranchBinding = {
  gid: 'ab'.repeat(8),
  rulesetHash: 'cd'.repeat(32),
  round: 0,
  stateHash: 'ef'.repeat(32),
  actingSeat: -1,
  successorCommitment: '00'.repeat(32),
};

function p2pkh(pub: Uint8Array): Script {
  return [OP.OP_DUP, OP.OP_HASH160, fairPlayCommitment(pub), OP.OP_EQUALVERIFY, OP.OP_CHECKSIG];
}
function sigWithType(msg: Uint8Array, k: KeyPair): Uint8Array {
  return Uint8Array.from([...signPreimage(msg, k.priv), SIGHASH_ALL_FORKID]);
}

async function main(): Promise<void> {
  daemon = spawn('python', ['-m', 'channel.cli', 'daemon-start', '--port', String(PORT), '--db', ':memory:'], {
    cwd: NODE_DIR,
    env: { ...process.env, PYTHONPATH: 'src' },
    stdio: 'ignore',
  });
  const node = new RealBsvNode('127.0.0.1', PORT);
  const k0 = genKeyPair(); // coinbase 所有者 / 出资方
  const p0 = genKeyPair(); // 玩家 0（赢家）
  const p1 = genKeyPair(); // 玩家 1
  try {
    const dl = Date.now() + 30000;
    while (!(await node.ping().catch(() => false))) {
      if (Date.now() > dl) throw new Error('node did not start');
      await new Promise((r) => setTimeout(r, 400));
    }

    const cb = await node.generateBlock(bytesToHex(k0.pubCompressed));
    console.log(`[onchain-poker] coinbase ${cb.coinbaseTxid.slice(0, 16)}… = ${SUBSIDY}`);

    // 1) FUNDING：把 coinbase 花费进一个 2-of-2 多签底池（funding 模板）。
    const pot = SUBSIDY - 1000;
    const fundingScript = fundingLocking(BIND, [p0.pubCompressed, p1.pubCompressed]);
    const fundingTx: Tx = {
      version: 1,
      inputs: [{ prevTxid: cb.coinbaseTxid, vout: 0, sequence: 0xffffffff }],
      outputs: [{ satoshis: pot, locking: fundingScript }],
      nLockTime: 0,
    };
    const fundMsg = sighashMessage(fundingTx, 0, p2pkh(k0.pubCompressed), SUBSIDY);
    const fundSig: Script = [sigWithType(fundMsg, k0), k0.pubCompressed];
    const fundRaw = bytesToHex(serializeTxWire(fundingTx, [fundSig]));
    const fundRes = await node.submitTx(fundRaw);
    console.log(`[onchain-poker] funding submit → ok=${fundRes.ok} reason="${fundRes.reason}"`);
    assert.equal(fundRes.ok, true, `funding rejected: ${fundRes.reason}`);
    await node.generateBlock(bytesToHex(k0.pubCompressed));
    const fundingTxid = txidWire(fundingTx, [fundSig]);
    assert.equal((await node.outpointStatus(fundingTxid, 0)).unspent, true, 'pot funded');

    // 2) SETTLEMENT：把 2-of-2 底池花费给赢家（p0）。
    const payout = pot - 1000;
    const settleTx: Tx = {
      version: 1,
      inputs: [{ prevTxid: fundingTxid, vout: 0, sequence: 0xffffffff }],
      outputs: [{ satoshis: payout, locking: p2pkh(p0.pubCompressed) }],
      nLockTime: 0,
    };
    const settleMsg = sighashMessage(settleTx, 0, fundingScript, pot);
    // N-of-N：双方玩家共同对结清签名（OP_0 占位 + 按 pubkey 顺序的签名）
    const settleSig = fundingUnlocking([sigWithType(settleMsg, p0), sigWithType(settleMsg, p1)]);
    const settleRaw = bytesToHex(serializeTxWire(settleTx, [settleSig]));
    const settleRes = await node.submitTx(settleRaw);
    console.log(`[onchain-poker] settlement submit → ok=${settleRes.ok} reason="${settleRes.reason}"`);
    assert.equal(settleRes.ok, true, `settlement rejected: ${settleRes.reason}`);
    await node.generateBlock(bytesToHex(k0.pubCompressed));

    const settleTxid = txidWire(settleTx, [settleSig]);
    assert.equal((await node.outpointStatus(fundingTxid, 0)).unspent, false, 'pot consumed by settlement');
    const won = await node.outpointStatus(settleTxid, 0);
    assert.equal(won.unspent, true, 'winner output confirmed');
    assert.equal(won.value, payout, 'winner receives the pot');
    console.log(`[onchain-poker] winner (p0) confirmed UTXO = ${won.value}`);

    console.log('\n[onchain-poker] PASS — poker funding multisig → settlement settled ON-CHAIN through the real node.');
  } finally {
    await node.shutdown();
    daemon?.kill();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('[onchain-poker] FAIL:', (e as Error).message);
    daemon?.kill();
    process.exit(1);
  },
);
