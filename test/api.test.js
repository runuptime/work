'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-test-'));
const { server } = require('../server');

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.close(); server.closeAllConnections(); });

function client() {
  let cookie = '';
  return async (p, body) => {
    const res = await fetch(base + p, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

test('signup, create coin with initial buy, trade, comment', async () => {
  const alice = client();
  const bob = client();
  let r = await alice('/api/signup', { username: 'alice', password: 'hunter22' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.me.balance, 10);
  assert.strictEqual((await bob('/api/signup', { username: 'ALICE', password: 'xxxxxx' })).status, 400);
  await bob('/api/signup', { username: 'bob', password: 'hunter22' });

  r = await alice('/api/coins', { name: 'Work Coin', ticker: '$work', description: 'gm', initialBuy: '1' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const id = r.data.coin.id;
  assert.strictEqual(r.data.coin.ticker, 'WORK');
  assert.ok(r.data.me.balance < 9.01);

  r = await bob(`/api/coins/${id}/quote?side=buy&amount=2`);
  r = await bob(`/api/coins/${id}/trade`, { side: 'buy', amount: '2', slippageBps: 100, expected: r.data.receive });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const bobTokens = r.data.me.holdings[id];
  assert.ok(bobTokens > 0);

  // Selling more than held fails; selling half works.
  assert.strictEqual((await bob(`/api/coins/${id}/trade`, { side: 'sell', amount: String(bobTokens * 2) })).status, 400);
  r = await bob(`/api/coins/${id}/trade`, { side: 'sell', amount: String(Math.floor(bobTokens / 2)) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));

  // Unrealistic slippage expectation is rejected.
  r = await bob(`/api/coins/${id}/trade`, { side: 'buy', amount: '0.1', slippageBps: 0, expected: '999999999' });
  assert.strictEqual(r.status, 400);

  r = await bob(`/api/coins/${id}/comments`, { text: '<script>alert(1)</script> to the moon' });
  assert.strictEqual(r.status, 200);

  r = await alice(`/api/coins/${id}`);
  assert.strictEqual(r.data.comments.length, 1);
  assert.strictEqual(r.data.trades.length, 3);
  assert.ok(r.data.holders.some((x) => x.curve));

  // Unauthenticated trades are refused.
  assert.strictEqual((await client()(`/api/coins/${id}/trade`, { side: 'buy', amount: '1' })).status, 401);

  r = await alice('/api/coins?sort=mcap');
  assert.strictEqual(r.data.coins[0].id, id);
  assert.strictEqual(r.data.king.id, id);

  r = await alice('/api/users/bob');
  assert.strictEqual(r.data.held[0].coin.id, id);
});

test('rejects non-JSON posts and bad images', async () => {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.strictEqual(res.status, 415);
  const c = client();
  await c('/api/signup', { username: 'carol', password: 'hunter22' });
  const r = await c('/api/coins', { name: 'x', ticker: 'X', image: 'data:image/png;base64,' + Buffer.from('<svg></svg>').toString('base64') });
  assert.strictEqual(r.status, 400);
});
