'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/curve');

test('initial price and market cap match pump.fun launch (~28 SOL mcap)', () => {
  const c = C.newCurve();
  assert.ok(Math.abs(C.marketCapSol(c) - 27.96) < 0.01);
  assert.strictEqual(C.progress(c), 0);
});

test('buy then sell everything returns less SOL than spent (fees)', () => {
  const c = C.newCurve();
  const b = C.quoteBuy(c, C.parseUnits('1', 9));
  C.applyBuy(c, b);
  assert.ok(b.tokensOut > 0n);
  const s = C.quoteSell(c, b.tokensOut);
  C.applySell(c, s);
  assert.ok(s.solOut < b.solIn);
  assert.ok(c.realSol >= 0n);
  assert.strictEqual(c.realTokens, C.CURVE.initialRealTokens);
});

test('buying the whole curve caps tokens and completes it at ~85 SOL', () => {
  const c = C.newCurve();
  const q = C.quoteBuy(c, C.parseUnits('500', 9));
  assert.strictEqual(q.tokensOut, C.CURVE.initialRealTokens);
  C.applyBuy(c, q);
  assert.ok(c.complete);
  assert.strictEqual(C.progress(c), 100);
  const sol = Number(c.realSol) / 1e9;
  assert.ok(sol > 84 && sol < 86, `realSol ${sol}`);
  assert.throws(() => C.quoteBuy(c, 1000n));
});

test('parseUnits / formatUnits round trip and reject junk', () => {
  assert.strictEqual(C.parseUnits('1.5', 9), 1_500_000_000n);
  assert.strictEqual(C.parseUnits('.25', 6), 250_000n);
  assert.strictEqual(C.formatUnits(1_500_000_000n, 9), '1.5');
  for (const bad of ['', '.', '-1', '1e5', 'abc', '1.2.3']) {
    assert.throws(() => C.parseUnits(bad, 9), bad);
  }
});
