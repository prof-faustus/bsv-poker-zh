/**
 * 针对真实嵌入式 BSV 节点的链上 UTXO/submit E2E（core §8.4, REQ-NET-004 / REQ-DEP-004）。
 * 平台挖一个 regtest 区块，然后从节点读取真实的 coinbase UTXO（outpoint
 * 状态 + 金额），检查 UTXO 集合大小，并通过节点真实的
 * Script interpreter 演练 submit 路径。这是平台在观察/驱动真正的链上状态，而非 fake。
 *
 * 完整接受由平台构建的扑克 tx（与 bitcoinx 逐字节一致的 sighash/script 互操作）
 * 是最后的链上步骤；本测试证明 chain-query + submit RPC 是真实且已接入的。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import assert from 'node:assert/strict';
import { RealBsvNode } from '@bsv-poker/adapters/real-node';
import { genKeyPair } from '@bsv-poker/script-templates-ts';
import { bytesToHex } from '@bsv-poker/protocol-types';

const NODE_DIR = process.env.BSV_NODE_DIR ?? 'D:\\claude\\ACM 01\\bonded-subsat-channel';
const PORT = Number(process.env.BSV_NODE_PORT ?? 8744);
const REGTEST_COINBASE = 5_000_000_000; // 50 BSV regtest 补贴（node.coinbase_reward）
let daemon: ChildProcess | null = null;

async function main(): Promise<void> {
  daemon = spawn('python', ['-m', 'channel.cli', 'daemon-start', '--port', String(PORT), '--db', ':memory:'], {
    cwd: NODE_DIR,
    env: { ...process.env, PYTHONPATH: 'src' },
    stdio: 'ignore',
  });
  const node = new RealBsvNode('127.0.0.1', PORT);
  const payoutPub = bytesToHex(genKeyPair().pubCompressed);
  try {
    const dl = Date.now() + 30000;
    while (!(await node.ping().catch(() => false))) {
      if (Date.now() > dl) throw new Error('node did not start');
      await new Promise((r) => setTimeout(r, 400));
    }

    console.log('[onchain-e2e] mining a regtest block (coinbase to the platform key)…');
    const block = await node.generateBlock(payoutPub);
    console.log(`[onchain-e2e] coinbase txid = ${block.coinbaseTxid.slice(0, 24)}…`);

    // 从节点读取真实的 coinbase UTXO。
    const out = await node.outpointStatus(block.coinbaseTxid, 0);
    console.log(`[onchain-e2e] coinbase outpoint: unspent=${out.unspent} value=${out.value}`);
    assert.equal(out.unspent, true, 'the freshly-mined coinbase output is unspent');
    assert.equal(out.value, REGTEST_COINBASE, 'coinbase value is the regtest subsidy');

    const count = await node.utxoCount();
    console.log(`[onchain-e2e] node UTXO-set size = ${count}`);
    assert.ok(count >= 1, 'the UTXO set holds the coinbase');

    // 一个已花费/不存在的 outpoint 读取为非未花费。
    const ghost = await node.outpointStatus('00'.repeat(32), 0);
    assert.equal(ghost.unspent, false, 'an unknown outpoint is not unspent');

    // submit RPC 抵达节点真实的验证器（无输入的 tx 会被拒绝并附带原因）。
    const emptyTx = '01000000' + '00' + '00' + '00000000';
    const res = await node.submitTx(emptyTx);
    console.log(`[onchain-e2e] submit(empty tx) → ok=${res.ok} reason="${res.reason}" (real validator)`);
    assert.equal(res.ok, false, 'the real validator rejects an input-less tx');

    console.log('\n[onchain-e2e] PASS — platform reads real UTXO state + submits through the real BSV validator.');
  } finally {
    await node.shutdown();
    daemon?.kill();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('[onchain-e2e] FAIL:', (e as Error).message);
    daemon?.kill();
    process.exit(1);
  },
);
