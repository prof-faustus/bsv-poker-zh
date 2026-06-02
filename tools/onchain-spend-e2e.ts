/**
 * 针对真实嵌入式 BSV 节点的完整链上 submit-and-confirm E2E（core §6, §8.4）。
 * 平台向它控制的密钥挖出一个 coinbase，然后完全用 TypeScript 构建并签名一笔真实的 P2PKH 花费
 * （BIP-143 sighash），提交它——节点通过其
 * 真实 Script interpreter 将其接受进 mempool——挖入它，平台通过 UTXO
 * RPC 观察到确认（coinbase 现已被花费，新输出未花费）。这是一笔真正的链上交易。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import assert from 'node:assert/strict';
import { RealBsvNode } from '@bsv-poker/adapters/real-node';
import { OP, genKeyPair, signPreimage, fairPlayCommitment, type Script } from '@bsv-poker/script-templates-ts';
import { bytesToHex } from '@bsv-poker/protocol-types';
import { type Tx, serializeTxWire, txidWire, sighashMessage, SIGHASH_ALL_FORKID } from '@bsv-poker/tx-builder';

const NODE_DIR = process.env.BSV_NODE_DIR ?? 'D:\\claude\\ACM 01\\bonded-subsat-channel';
const PORT = Number(process.env.BSV_NODE_PORT ?? 8744);
const SUBSIDY = 5_000_000_000;
let daemon: ChildProcess | null = null;

function p2pkh(pubCompressed: Uint8Array): Script {
  return [OP.OP_DUP, OP.OP_HASH160, fairPlayCommitment(pubCompressed), OP.OP_EQUALVERIFY, OP.OP_CHECKSIG];
}

async function main(): Promise<void> {
  daemon = spawn('python', ['-m', 'channel.cli', 'daemon-start', '--port', String(PORT), '--db', ':memory:'], {
    cwd: NODE_DIR,
    env: { ...process.env, PYTHONPATH: 'src' },
    stdio: 'ignore',
  });
  const node = new RealBsvNode('127.0.0.1', PORT);
  const k = genKeyPair();
  const payoutPub = bytesToHex(k.pubCompressed);
  try {
    const dl = Date.now() + 30000;
    while (!(await node.ping().catch(() => false))) {
      if (Date.now() > dl) throw new Error('node did not start');
      await new Promise((r) => setTimeout(r, 400));
    }

    console.log('[onchain-spend] mining a coinbase to the platform key…');
    const block = await node.generateBlock(payoutPub);
    const coinbaseTxid = block.coinbaseTxid;
    const before = await node.outpointStatus(coinbaseTxid, 0);
    assert.equal(before.unspent, true);
    console.log(`[onchain-spend] coinbase ${coinbaseTxid.slice(0, 16)}…:0 value=${before.value}`);

    // 构建一笔真实的 coinbase P2PKH 花费，把 value-1000 支付回同一密钥。
    const scriptCode = p2pkh(k.pubCompressed); // coinbase 的 P2PKH scriptPubKey
    const spend: Tx = {
      version: 1,
      inputs: [{ prevTxid: coinbaseTxid, vout: 0, sequence: 0xffffffff }],
      outputs: [{ satoshis: SUBSIDY - 1000, locking: p2pkh(k.pubCompressed) }],
      nLockTime: 0,
    };
    // 对 BIP-143 sighash 签名；scriptSig 中的签名携带 sighash-type 字节（ALL|FORKID）。
    const msg = sighashMessage(spend, 0, scriptCode, SUBSIDY);
    const der = signPreimage(msg, k.priv);
    const sigWithType = Uint8Array.from([...der, SIGHASH_ALL_FORKID]);
    const scriptSig: Script = [sigWithType, k.pubCompressed];
    const rawTx = bytesToHex(serializeTxWire(spend, [scriptSig]));
    const spendTxid = txidWire(spend, [scriptSig]);

    console.log('[onchain-spend] submitting the signed spend to the node…');
    const res = await node.submitTx(rawTx);
    console.log(`[onchain-spend] submit → ok=${res.ok} reason="${res.reason}" txid=${res.txid.slice(0, 16)}…`);
    assert.equal(res.ok, true, `node must accept the platform-signed spend (reason: ${res.reason})`);

    console.log('[onchain-spend] mining a block to confirm…');
    await node.generateBlock(payoutPub);
    const coinbaseAfter = await node.outpointStatus(coinbaseTxid, 0);
    const newOut = await node.outpointStatus(spendTxid, 0);
    console.log(`[onchain-spend] coinbase now spent=${!coinbaseAfter.unspent}; new output unspent=${newOut.unspent} value=${newOut.value}`);
    assert.equal(coinbaseAfter.unspent, false, 'coinbase consumed by the confirmed spend');
    assert.equal(newOut.unspent, true, 'the spend output is now a confirmed UTXO');
    assert.equal(newOut.value, SUBSIDY - 1000, 'output value');

    console.log('\n[onchain-spend] PASS — platform built+signed a real tx; the node accepted, mined, and confirmed it.');
  } finally {
    await node.shutdown();
    daemon?.kill();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('[onchain-spend] FAIL:', (e as Error).message);
    daemon?.kill();
    process.exit(1);
  },
);
