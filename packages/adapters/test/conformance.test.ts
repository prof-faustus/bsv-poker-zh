import { test } from 'node:test';
import {
  makeFakeCT,
  makeFakeBS,
  makeFakeVA,
  makeFakeOB,
} from '../src/index.ts';
import {
  runCTConformance,
  runBSConformance,
  runVAConformance,
  runOBConformance,
} from '../src/conformance.ts';

// REQ-DEP-003：同一套测试套件同时对 fake（此处）和真实适配器运行
//（crypto-mentalpoker 的 RealCT 在其自己的测试中运行它）——两者都必须通过。
test('CT fake passes the CT conformance suite', async () => {
  await runCTConformance(makeFakeCT());
});
test('BS fake passes the BS conformance suite', async () => {
  await runBSConformance(makeFakeBS());
});
test('VA fake passes the VA conformance suite', async () => {
  await runVAConformance(makeFakeVA());
});
test('OB fake passes the OB conformance suite', async () => {
  await runOBConformance(makeFakeOB());
});
