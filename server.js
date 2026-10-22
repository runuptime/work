'use strict';
// pump.fun replica: a paper-trading token launchpad. No real wallets or chains — every
// account trades play-money SOL against a simulated bonding curve.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./lib/curve');
const store = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGE_DIR = path.join(store.DATA_DIR, 'images');
const SOL_USD = Number(process.env.SOL_USD) || 150; // fixed display rate
const STARTING_BALANCE = 10n * C.LAMPORTS;
const FAUCET_AMOUNT = 5n * C.LAMPORTS;
const FAUCET_COOLDOWN_MS = 60 * 60 * 1000;
const KOTH_PROGRESS = 50; // % of curve sold to become king of the hill
const MAX_BODY = 1_500_000;

const state = store.load();
const save = () => store.scheduleSave(state);
const nextId = () => (state.seq++).toString(36);

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('invalid json')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const tok = parseCookies(req).sid;
  const name = tok && state.sessions[tok];
  return name ? state.users[name] : null;
}

function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw new HttpError(401, 'log in first');
  return u;
}

function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 32).toString('hex');
}

function sessionCookie(tok, maxAge) {
  return `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// Tiny fixed-window rate limiter keyed by user/action.
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) { buckets.set(key, { start: now, n: 1 }); return; }
  if (++b.n > max) throw new HttpError(429, 'slow down');
}

const sol = (lamports) => Number(lamports) / 1e9;
const tok = (units) => Number(units) / 1e6;

function findCoin(id) {
  const coin = state.coins.find((c) => c.id === id);
  if (!coin) throw new HttpError(404, 'coin not found');
  return coin;
}

function coinView(coin) {
  const c = coin.curve;
  const mcap = C.marketCapSol(c);
  return {
    id: coin.id,
    name: coin.name,
    ticker: coin.ticker,
    description: coin.description,
    image: coin.image,
    links: coin.links,
    creator: coin.creator,
    createdAt: coin.createdAt,
    lastTradeAt: coin.lastTradeAt,
    replyCount: coin.replyCount,
    kothAt: coin.kothAt || null,
    graduatedAt: coin.graduatedAt || null,
    complete: c.complete,
    price: C.price(c),
    marketCapSol: mcap,
    marketCapUsd: mcap * SOL_USD,
    progress: C.progress(c),
    realSol: sol(c.realSol),
    tokensLeft: tok(c.realTokens),
  };
}

function userPublic(u) {
  return { name: u.name, createdAt: u.createdAt };
}

function userPrivate(u) {
  return {
    ...userPublic(u),
    balance: sol(u.balance),
    faucetReadyAt: (u.lastFaucet || 0) + FAUCET_COOLDOWN_MS,
    holdings: Object.fromEntries(Object.entries(u.holdings).filter(([, v]) => v > 0n).map(([k, v]) => [k, tok(v)])),
  };
}

function holders(coinId) {
  const list = [];
  for (const u of Object.values(state.users)) {
    const v = u.holdings[coinId];
    if (v && v > 0n) list.push({ name: u.name, tokens: tok(v), pct: Number((v * 10_000n) / C.CURVE.totalSupply) / 100 });
  }
  const coin = findCoin(coinId);
  if (coin.curve.realTokens > 0n) {
    // Tokens still on the curve are held by the bonding curve account, like on pump.fun.
    list.push({ name: 'bonding curve', curve: true, tokens: tok(coin.curve.realTokens), pct: Number((coin.curve.realTokens * 10_000n) / C.CURVE.totalSupply) / 100 });
  }
  return list.sort((a, b) => b.tokens - a.tokens).slice(0, 20);
}

function king() {
  let best = null;
  for (const c of state.coins) {
    if (c.kothAt && !c.curve.complete && (!best || c.kothAt > best.kothAt)) best = c;
  }
  if (!best) {
    for (const c of state.coins) {
      if (!c.curve.complete && (!best || C.marketCapSol(c.curve) > C.marketCapSol(best.curve))) best = c;
    }
  }
  return best;
}

// ---------- live events (SSE) ----------

const clients = new Set();
function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000).unref();

// ---------- trading ----------

function executeTrade(user, coin, side, amountStr, slippageBps, expected) {
  const c = coin.curve;
  if (c.complete) throw bad('this coin graduated; the bonding curve is closed');
  let trade;
  if (side === 'buy') {
    const lamports = C.parseUnits(amountStr, 9);
    if (lamports > user.balance) throw bad('insufficient SOL balance');
    const q = C.quoteBuy(c, lamports);
    if (q.solIn > user.balance) throw bad('insufficient SOL balance');
    checkSlippage(q.tokensOut, expected, slippageBps, 6);
    C.applyBuy(c, q);
    user.balance -= q.solIn;
    user.holdings[coin.id] = (user.holdings[coin.id] || 0n) + q.tokensOut;
    trade = { side, sol: sol(q.solIn), tokens: tok(q.tokensOut) };
  } else if (side === 'sell') {
    const units = C.parseUnits(amountStr, 6);
    const held = user.holdings[coin.id] || 0n;
    if (units > held) throw bad('insufficient token balance');
    const q = C.quoteSell(c, units);
    checkSlippage(q.solOut, expected, slippageBps, 9);
    C.applySell(c, q);
    user.balance += q.solOut;
    user.holdings[coin.id] = held - units;
    trade = { side, sol: sol(q.solOut), tokens: tok(units) };
  } else {
    throw bad('side must be buy or sell');
  }

  const now = Date.now();
  Object.assign(trade, {
    id: nextId(), coinId: coin.id, user: user.name, ts: now,
    price: C.price(c), marketCapSol: C.marketCapSol(c),
  });
  (state.trades[coin.id] ||= []).push(trade);
  coin.lastTradeAt = now;

  const events = [{ type: 'trade', trade, coin: null }];
  if (!coin.kothAt && C.progress(c) >= KOTH_PROGRESS) {
    coin.kothAt = now;
    events.push({ type: 'koth', coinId: coin.id });
  }
  if (c.complete && !coin.graduatedAt) {
    coin.graduatedAt = now;
    events.push({ type: 'graduated', coinId: coin.id });
  }
  const view = coinView(coin);
  events[0].coin = view;
  for (const e of events) broadcast({ ...e, ticker: coin.ticker, name: coin.name, image: coin.image });
  save();
  return { trade, coin: view, me: userPrivate(user) };
}

// expected/slippage are optional; when given, refuse fills worse than expected*(1-slippage).
function checkSlippage(actual, expected, slippageBps, decimals) {
  if (expected === undefined || expected === null || expected === '') return;
  const exp = C.parseUnits(String(expected), decimals);
  const bps = BigInt(Math.max(0, Math.min(5000, Math.floor(Number(slippageBps) || 0))));
  const min = (exp * (10_000n - bps)) / 10_000n;
  if (actual < min) throw bad('price moved beyond your slippage tolerance, try again');
}

// ---------- image upload ----------

const IMAGE_TYPES = {
  png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  gif: { mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  webp: { mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
};

function saveImage(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw bad('image must be a png, jpg, gif or webp');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 1_000_000) throw bad('image must be under 1MB');
  const ext = Object.keys(IMAGE_TYPES).find((k) => IMAGE_TYPES[k].magic.every((b, i) => buf[i] === b));
  if (!ext || (ext === 'webp' && buf.toString('ascii', 8, 12) !== 'WEBP')) throw bad('image must be a png, jpg, gif or webp');
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(IMAGE_DIR, name), buf);
  return '/img/' + name;
}

function cleanLink(v) {
  if (!v) return '';
  v = String(v).trim().slice(0, 200);
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}

// ---------- routes ----------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern + '$'), handler });

route('GET', '/api/me', (req) => {
  const u = currentUser(req);
  return { me: u ? userPrivate(u) : null, solUsd: SOL_USD };
});

route('POST', '/api/signup', async (req, res) => {
  const { username, password } = await readBody(req);
  rateLimit('signup:' + req.socket.remoteAddress, 5, 60 * 60 * 1000);
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) throw bad('username: 3-16 letters, numbers or _');
  if (typeof password !== 'string' || password.length < 6 || password.length > 200) throw bad('password must be at least 6 characters');
  const key = username.toLowerCase();
  if (state.users[key] || key === 'bonding_curve') throw bad('username taken');
  const salt = crypto.randomBytes(16).toString('hex');
  state.users[key] = {
    name: username, salt, hash: hashPassword(password, salt),
    balance: STARTING_BALANCE, holdings: {}, createdAt: Date.now(), lastFaucet: Date.now(),
  };
  return login(res, state.users[key]);
});

route('POST', '/api/login', async (req, res) => {
  const { username, password } = await readBody(req);
  rateLimit('login:' + req.socket.remoteAddress, 20, 15 * 60 * 1000);
  const u = typeof username === 'string' && state.users[username.toLowerCase()];
  if (!u || typeof password !== 'string' || !crypto.timingSafeEqual(Buffer.from(hashPassword(password, u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) {
    throw bad('wrong username or password');
  }
  return login(res, u);
});

function login(res, u) {
  const t = crypto.randomBytes(24).toString('hex');
  state.sessions[t] = u.name.toLowerCase();
  save();
  res.setHeader('Set-Cookie', sessionCookie(t, 60 * 60 * 24 * 30));
  return { me: userPrivate(u) };
}

route('POST', '/api/logout', (req, res) => {
  const t = parseCookies(req).sid;
  if (t) delete state.sessions[t];
  save();
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  return { ok: true };
});

route('POST', '/api/faucet', (req) => {
  const u = requireUser(req);
  const wait = (u.lastFaucet || 0) + FAUCET_COOLDOWN_MS - Date.now();
  if (wait > 0) throw bad(`faucet ready in ${Math.ceil(wait / 60000)} min`);
  u.balance += FAUCET_AMOUNT;
  u.lastFaucet = Date.now();
  save();
  return { me: userPrivate(u) };
});

route('GET', '/api/coins', (req, res, _m, url) => {
  const sort = url.searchParams.get('sort') || 'bump';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const filter = url.searchParams.get('filter') || 'all';
  let list = state.coins;
  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q) || c.id === q);
  if (filter === 'graduated') list = list.filter((c) => c.curve.complete);
  else if (filter === 'live') list = list.filter((c) => !c.curve.complete);
  const views = list.map(coinView);
  const sorters = {
    bump: (a, b) => (b.lastTradeAt || b.createdAt) - (a.lastTradeAt || a.createdAt),
    new: (a, b) => b.createdAt - a.createdAt,
    mcap: (a, b) => b.marketCapSol - a.marketCapSol,
    replies: (a, b) => b.replyCount - a.replyCount,
    trade: (a, b) => (b.lastTradeAt || 0) - (a.lastTradeAt || 0),
  };
  views.sort(sorters[sort] || sorters.bump);
  const k = king();
  return { coins: views.slice(0, 120), king: k ? coinView(k) : null };
});

route('POST', '/api/coins', async (req) => {
  const u = requireUser(req);
  const body = await readBody(req);
  rateLimit('create:' + u.name, 5, 60 * 60 * 1000);
  const name = String(body.name || '').trim();
  const ticker = String(body.ticker || '').trim().replace(/^\$/, '').toUpperCase();
  const description = String(body.description || '').trim();
  if (name.length < 1 || name.length > 32) throw bad('name: 1-32 characters');
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) throw bad('ticker: 1-10 letters or numbers');
  if (description.length > 500) throw bad('description: max 500 characters');
  const initialBuy = body.initialBuy ? C.parseUnits(String(body.initialBuy), 9) : 0n;
  if (initialBuy > u.balance) throw bad('insufficient SOL for initial buy');
  const image = saveImage(body.image);
  const coin = {
    id: nextId(), name, ticker, description, image,
    links: { twitter: cleanLink(body.twitter), telegram: cleanLink(body.telegram), website: cleanLink(body.website) },
    creator: u.name, createdAt: Date.now(), lastTradeAt: null, replyCount: 0,
    curve: C.newCurve(),
  };
  state.coins.push(coin);
  state.trades[coin.id] = [];
  state.comments[coin.id] = [];
  broadcast({ type: 'create', coin: coinView(coin), ticker, name, image, user: u.name });
  if (initialBuy > 0n) executeTrade(u, coin, 'buy', C.formatUnits(initialBuy, 9));
  save();
  return { coin: coinView(coin), me: userPrivate(u) };
});

route('GET', '/api/coins/([a-z0-9]+)', (req, res, m) => {
  const coin = findCoin(m[1]);
  const u = currentUser(req);
  return {
    coin: coinView(coin),
    trades: state.trades[coin.id].slice(-100).reverse(),
    comments: state.comments[coin.id].slice(-200),
    holders: holders(coin.id),
    myTokens: u ? tok(u.holdings[coin.id] || 0n) : 0,
  };
});

route('GET', '/api/coins/([a-z0-9]+)/trades', (req, res, m) => {
  const coin = findCoin(m[1]);
  return { trades: state.trades[coin.id].map(({ ts, price, side, sol: s }) => ({ ts, price, side, sol: s })) };
});

route('GET', '/api/coins/([a-z0-9]+)/quote', (req, res, m, url) => {
  const coin = findCoin(m[1]);
  const side = url.searchParams.get('side');
  const amount = url.searchParams.get('amount') || '';
  try {
    if (side === 'buy') {
      const q = C.quoteBuy(coin.curve, C.parseUnits(amount, 9));
      return { side, spend: sol(q.solIn), fee: sol(q.fee), receive: C.formatUnits(q.tokensOut, 6) };
    }
    if (side === 'sell') {
      const q = C.quoteSell(coin.curve, C.parseUnits(amount, 6));
      return { side, spend: tok(q.tokensIn), fee: sol(q.fee), receive: C.formatUnits(q.solOut, 9) };
    }
    throw new Error('side must be buy or sell');
  } catch (e) {
    throw bad(e.message);
  }
});

route('POST', '/api/coins/([a-z0-9]+)/trade', async (req, res, m) => {
  const u = requireUser(req);
  const coin = findCoin(m[1]);
  const { side, amount, slippageBps, expected } = await readBody(req);
  rateLimit('trade:' + u.name, 60, 60 * 1000);
  try {
    return executeTrade(u, coin, side, String(amount ?? ''), slippageBps, expected);
  } catch (e) {
    throw e instanceof HttpError ? e : bad(e.message);
  }
});

route('POST', '/api/coins/([a-z0-9]+)/comments', async (req, res, m) => {
  const u = requireUser(req);
  const coin = findCoin(m[1]);
  const { text } = await readBody(req);
  rateLimit('comment:' + u.name, 10, 60 * 1000);
  const t = String(text || '').trim();
  if (!t || t.length > 500) throw bad('comment: 1-500 characters');
  const comment = { id: nextId(), user: u.name, text: t, ts: Date.now() };
  state.comments[coin.id].push(comment);
  coin.replyCount++;
  broadcast({ type: 'comment', coinId: coin.id, comment });
  save();
  return { comment };
});

route('GET', '/api/users/([a-zA-Z0-9_]+)', (req, res, m) => {
  const u = state.users[m[1].toLowerCase()];
  if (!u) throw new HttpError(404, 'user not found');
  const created = state.coins.filter((c) => c.creator === u.name).map(coinView);
  const held = Object.entries(u.holdings)
    .filter(([, v]) => v > 0n)
    .map(([id, v]) => {
      const coin = state.coins.find((c) => c.id === id);
      return coin && { coin: coinView(coin), tokens: tok(v), valueSol: tok(v) * C.price(coin.curve) };
    })
    .filter(Boolean)
    .sort((a, b) => b.valueSol - a.valueSol);
  return { user: userPublic(u), created, held };
});

route('GET', '/api/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': hi\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
  return undefined;
});

// ---------- static ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveFile(res, file, type, cache) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

function serveStatic(req, res, url) {
  const p = url.pathname;
  if (p.startsWith('/img/')) {
    const name = p.slice(5);
    if (!/^[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(name)) return send(res, 404, 'not found');
    const ext = name.split('.').pop();
    return serveFile(res, path.join(IMAGE_DIR, name), IMAGE_TYPES[ext].mime, 'public, max-age=31536000, immutable');
  }
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (file.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return serveFile(res, file, MIME[path.extname(file)] || 'application/octet-stream', 'no-cache');
  }
  // SPA routes
  if (/^\/($|coin\/|create$|profile\/|how-it-works$)/.test(p)) {
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), MIME['.html'], 'no-cache');
  }
  send(res, 404, 'not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return serveStatic(req, res, url);
  }
  // Basic CSRF guard: state-changing requests must be same-origin JSON.
  if (req.method === 'POST' && !(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { error: 'expected application/json' });
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    try {
      const out = await r.handler(req, res, m, url);
      if (out !== undefined) send(res, 200, out);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'internal error' : e.message });
    }
    return;
  }
  send(res, 404, { error: 'not found' });
});

function shutdown() {
  try { store.saveNow(state); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`pump replica listening on http://${HOST}:${PORT}`));
}

module.exports = { server, state };
