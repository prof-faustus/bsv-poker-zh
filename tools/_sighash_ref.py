#!/usr/bin/env python3
"""通过 bitcoinx 计算参考 BIP-143 (FORKID) sighash —— 即嵌入式 BSV 节点用于校验的库。
从 JSON argv[1] 读取 {rawTx,index,value,scriptCode,sighashType}；打印 sighash 的十六进制。
被 tools/sighash-interop.ts 使用，以证明平台的 TS sighash 与节点的逐字节匹配。
"""
import json
import sys

from bitcoinx import Script, SigHash, Tx

data = json.loads(sys.argv[1])
tx = Tx.from_hex(data["rawTx"])
sh = SigHash(data["sighashType"])
digest = tx.signature_hash(
    data["index"], data["value"], Script(bytes.fromhex(data["scriptCode"])), sh
)
print(digest.hex())
