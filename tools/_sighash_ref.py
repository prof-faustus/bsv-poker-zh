#!/usr/bin/env python3
"""Reference BIP-143 (FORKID) sighash via bitcoinx — the library the embedded BSV node validates
with. Reads {rawTx,index,value,scriptCode,sighashType} as JSON argv[1]; prints the sighash hex.
Used by tools/sighash-interop.ts to prove the platform's TS sighash matches the node's byte-for-byte.
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
