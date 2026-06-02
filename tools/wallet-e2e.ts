/**
 * 钱包入金/出金 E2E（core §9, app §A6.2），使用真实的 regtest 入金。演示了
 * 可上线的资金接缝：一个由节点支撑的 FundingBackend，其入金通过嵌入式 BSV 节点
 * 挖出一个真实的 regtest 区块（玩家的 coinbase）。随后进行买入 / 兑出 / 提现。
 *
 * 节点守护进程暴露 mine/height（暂无 balance/UTXO RPC），因此入账的 coinbase 金额
 * 是 regtest 补贴常量（TRACKED ASSUMPTION）—— 真实的部分在于入金
 * 通过节点触发了一个链上区块（高度推进）。Mainnet 的入金/出金会在带研究标志的前提下
 * 替换同一个 WalletService 背后的后端。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import assert from 'node:assert/strict';
import { RealBsvNode } from '@bsv-poker/adapters/real-node';
import { genKeyPair } from '@bsv-poker/script-templates-ts';
import { bytesToHex } from '@bsv-poker/protocol-types';
import { WalletService, type FundingBackend } from '@bsv-poker/app-services';

const NODE_DIR = process.env.BSV_NODE_DIR ?? 'D:\\claude\\ACM 01\\bonded-subsat-channel';
const PORT = Number(process.env.BSV_NODE_PORT ?? 8744);
const REGTEST_SUBSIDY = 5_000_000_000; // 每个 regtest coinbase 的 sats（TRACKED ASSUMPTION）
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
    const deadline = Date.now() + 30000;
    while (!(await node.ping().catch(() => false))) {
      if (Date.now() > deadline) throw new Error('node did not start');
      await new Promise((r) => setTimeout(r, 400));
    }

    // 由节点支撑的资金：入金会向玩家的密钥挖出一个真实的 regtest coinbase。
    const backend: FundingBackend = {
      async deposit() {
        await node.generateBlock(payoutPub);
      },
      async withdraw() {
        // 真实的链上花费是上线接缝（节点 tx-submit RPC 待定）；此处为游戏币扣款
      },
    };
    const wallet = new WalletService({ network: 'regtest', backend });

    const h0 = await node.height();
    console.log(`[wallet-e2e] node height before deposit = ${h0}; wallet balance = ${wallet.getBalance()}`);

    console.log('[wallet-e2e] ADD FUNDS → mines a real regtest block (coinbase to the player)…');
    await wallet.addFunds(REGTEST_SUBSIDY, { memo: 'regtest coinbase' });
    const h1 = await node.height();
    assert.equal(h1, h0 + 1, 'deposit mined exactly one real block');
    assert.equal(wallet.getBalance(), REGTEST_SUBSIDY);
    console.log(`[wallet-e2e] node height after deposit = ${h1}; wallet balance = ${wallet.getBalance()}`);

    console.log('[wallet-e2e] buy in 200 → play a session → cash out 260…');
    const stack = wallet.buyIn(200, 'table-1');
    assert.equal(stack, 200);
    wallet.cashOut(260, 'table-1');
    assert.equal(wallet.getBalance(), REGTEST_SUBSIDY + 60);

    console.log('[wallet-e2e] REMOVE FUNDS (withdraw 1000)…');
    await wallet.withdraw(1000, 'mxExternalRegtestAddr');
    assert.equal(wallet.getBalance(), REGTEST_SUBSIDY + 60 - 1000);

    console.log(`[wallet-e2e] history: ${wallet.state().history.map((e) => `${e.kind}:${e.amount}`).join(', ')}`);
    console.log('\n[wallet-e2e] PASS — wallet adds funds via a REAL regtest mine, buys in, cashes out, withdraws.');
  } finally {
    await node.shutdown();
    daemon?.kill();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('[wallet-e2e] FAIL:', (e as Error).message);
    daemon?.kill();
    process.exit(1);
  },
);
