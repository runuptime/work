'use strict';
// Single-page client for the launchpad. All user content goes through textContent via h().

const TOTAL_SUPPLY = 1e9;
const INITIAL_PRICE = 30 / 1_073_000_000;
let ME = null;
let SOL_USD = 150;
let view = { cleanup: null, onEvent: null };

// ---------- utils ----------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function toast(msg, err) {
  const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 4000);
}

function usd(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function num(n, d = 2) {
  if (n >= 1e9) return (n / 1e9).toFixed(d) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(d) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(d) + 'K';
  return Number(n.toFixed(4)).toString();
}

function solFmt(n) {
  return Number(n.toFixed(n < 1 ? 4 : 3)).toString();
}

function ago(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// Deterministic placeholder avatar for coins without an image.
function coinImg(coin, cls = 'thumb') {
  if (coin.image) return h('img', { class: cls, src: coin.image, alt: coin.ticker, loading: 'lazy' });
  let hash = 0;
  for (const ch of coin.ticker + coin.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return h('div', { class: cls + ' ph', style: { background: `linear-gradient(135deg,hsl(${hue} 80% 60%),hsl(${(hue + 60) % 360} 80% 45%))` } }, coin.ticker.slice(0, 3));
}

function userLink(name) {
  return h('a', { href: '/profile/' + encodeURIComponent(name), 'data-link': true, class: 'user-chip' }, name);
}

// ---------- routing ----------

function navigate(path) {
  history.pushState(null, '', path);
  render();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && a.origin === location.origin) {
    e.preventDefault();
    navigate(a.pathname + a.search);
  }
});
window.addEventListener('popstate', render);

function render() {
  if (view.cleanup) view.cleanup();
  view = { cleanup: null, onEvent: null };
  const app = document.getElementById('app');
  app.replaceChildren();
  const p = location.pathname;
  let m;
  if (p === '/') renderBoard(app);
  else if (p === '/create') renderCreate(app);
  else if (p === '/how-it-works') renderHow(app);
  else if ((m = p.match(/^\/coin\/([a-z0-9]+)$/))) renderCoin(app, m[1]);
  else if ((m = p.match(/^\/profile\/([A-Za-z0-9_]+)$/))) renderProfile(app, m[1]);
  else app.append(h('p', { class: 'center' }, 'not found'));
  window.scrollTo(0, 0);
}

// ---------- account ----------

function renderAccount() {
  const el = document.getElementById('account');
  el.replaceChildren();
  if (!ME) {
    el.append(h('button', { class: 'btn green', onclick: () => openAuth(false) }, 'log in'));
    return;
  }
  const ready = Date.now() >= ME.faucetReadyAt;
  el.append(
    h('span', { class: 'balance' }, solFmt(ME.balance), ' SOL'),
    h('button', {
      class: 'btn ghost', title: ready ? 'claim 5 play SOL' : 'faucet cooling down',
      onclick: async () => {
        try { ME = (await api('/api/faucet', { body: {} })).me; renderAccount(); toast('+5 play SOL'); } catch (e) { toast(e.message, true); }
      },
    }, ready ? 'faucet' : 'faucet ⏳'),
    h('a', { href: '/profile/' + ME.name, 'data-link': true, class: 'bracket' }, '[', ME.name, ']'),
    h('button', { class: 'btn ghost', onclick: async () => { await api('/api/logout', { body: {} }); ME = null; renderAccount(); render(); } }, 'log out'),
  );
}

let authSignup = false;
function openAuth(signup) {
  authSignup = signup;
  syncAuth();
  document.getElementById('auth-error').textContent = '';
  document.getElementById('auth').showModal();
}
function syncAuth() {
  document.getElementById('auth-title').textContent = authSignup ? 'sign up' : 'log in';
  document.getElementById('auth-submit').textContent = authSignup ? 'create account' : 'log in';
  document.getElementById('auth-toggle').textContent = authSignup ? 'have an account? log in' : 'need an account? sign up';
}
document.getElementById('auth-toggle').addEventListener('click', (e) => { e.preventDefault(); authSignup = !authSignup; syncAuth(); });
document.getElementById('auth-close').addEventListener('click', () => document.getElementById('auth').close());
document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const data = await api(authSignup ? '/api/signup' : '/api/login', { body: { username: f.get('username'), password: f.get('password') } });
    ME = data.me;
    document.getElementById('auth').close();
    e.target.reset();
    renderAccount();
    render();
  } catch (err) {
    document.getElementById('auth-error').textContent = err.message;
  }
});

function requireLogin() {
  if (!ME) { openAuth(false); return false; }
  return true;
}

// ---------- live feed ----------

function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    pushTicker(ev);
    if (view.onEvent) view.onEvent(ev);
  };
}

function pushTicker(ev) {
  if (ev.type !== 'trade' && ev.type !== 'create') return;
  const el = document.getElementById('ticker');
  const coinLike = { image: ev.image, ticker: ev.ticker, id: ev.coin ? ev.coin.id : '' };
  const link = '/coin/' + (ev.coin ? ev.coin.id : '');
  const node = ev.type === 'trade'
    ? h('a', { href: link, 'data-link': true, class: 'tick shake ' + ev.trade.side }, ev.trade.user, ev.trade.side === 'buy' ? ' bought ' : ' sold ', solFmt(ev.trade.sol), ' SOL of ', coinImg(coinLike, ''), ev.ticker)
    : h('a', { href: link, 'data-link': true, class: 'tick shake create' }, ev.user, ' created ', coinImg(coinLike, ''), ev.ticker);
  el.replaceChildren(node);
}

// ---------- board ----------

function coinCard(c, opts = {}) {
  return h('a', { href: '/coin/' + c.id, 'data-link': true, class: 'card', 'data-id': c.id },
    coinImg(c),
    h('div', { class: 'meta' },
      h('div', { class: 'muted' }, 'created by ', h('span', { class: 'user-chip' }, c.creator), ' ', ago(c.createdAt)),
      h('div', { class: 'mc' }, 'market cap: ', usd(c.marketCapUsd), c.complete ? '' : ` (${c.progress.toFixed(0)}%)`,
        c.complete ? h('span', { class: 'badge grad' }, ' graduated') : null,
        opts.king ? h('span', { class: 'badge king' }, ' 👑') : null),
      h('div', { class: 'muted' }, 'replies: ', c.replyCount),
      h('div', { class: 'title' }, h('b', {}, c.name), ' (ticker: ', c.ticker, ')'),
      c.description ? h('div', { class: 'desc' }, c.description) : null,
    ));
}

function renderBoard(app) {
  const params = new URLSearchParams(location.search);
  const state = { sort: params.get('sort') || 'bump', filter: params.get('filter') || 'all', q: params.get('q') || '' };
  const kothEl = h('div', { class: 'koth' });
  const grid = h('div', { class: 'grid' });
  const search = h('input', { placeholder: 'search for token', value: state.q });
  const sortSel = h('select', {},
    ...[['bump', 'sort: bump order'], ['new', 'sort: creation time'], ['trade', 'sort: last trade'], ['mcap', 'sort: market cap'], ['replies', 'sort: last reply count']]
      .map(([v, t]) => h('option', { value: v, selected: v === state.sort }, t)));
  const filterSel = h('select', {},
    ...[['all', 'show: all'], ['live', 'show: on bonding curve'], ['graduated', 'show: graduated']]
      .map(([v, t]) => h('option', { value: v, selected: v === state.filter }, t)));

  async function load() {
    const qs = new URLSearchParams({ sort: state.sort, filter: state.filter, q: state.q });
    history.replaceState(null, '', '/?' + qs);
    const data = await api('/api/coins?' + qs);
    kothEl.replaceChildren();
    if (data.king) kothEl.append(h('h3', {}, 'king of the hill'), coinCard(data.king, { king: true }));
    grid.replaceChildren(...data.coins.map((c) => coinCard(c)));
    if (!data.coins.length) grid.append(h('p', { class: 'muted' }, state.q ? 'no coins match.' : 'no coins yet — be the first to start one.'));
  }

  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.q = search.value.trim(); load(); } });
  sortSel.addEventListener('change', () => { state.sort = sortSel.value; load(); });
  filterSel.addEventListener('change', () => { state.filter = filterSel.value; load(); });

  app.append(
    h('a', { href: '/create', 'data-link': true, class: 'start-link center' }, '[start a new coin]'),
    kothEl,
    h('div', { class: 'searchbar' }, search, h('button', { class: 'btn green', onclick: () => { state.q = search.value.trim(); load(); } }, 'search')),
    h('div', { class: 'controls' }, sortSel, filterSel),
    grid,
  );
  load().catch((e) => toast(e.message, true));

  let pending = null;
  view.onEvent = (ev) => {
    if (ev.type === 'trade' || ev.type === 'create' || ev.type === 'koth' || ev.type === 'graduated') {
      // Coalesce bursts, then flash the bumped card like pump.fun does.
      clearTimeout(pending);
      pending = setTimeout(async () => {
        await load().catch(() => {});
        const id = ev.coin ? ev.coin.id : ev.coinId;
        const card = grid.querySelector(`[data-id="${id}"]`);
        if (card) card.classList.add('flash');
      }, 300);
    }
  };
  view.cleanup = () => clearTimeout(pending);
}

// ---------- create ----------

function renderCreate(app) {
  if (!ME) {
    app.append(h('div', { class: 'center' }, h('p', {}, 'log in to start a new coin.'), h('button', { class: 'btn green', onclick: () => openAuth(true) }, 'sign up / log in')));
    return;
  }
  let imageData = null;
  const preview = h('div');
  const err = h('p', { class: 'error' });
  const extra = h('div', { style: { display: 'none', flexDirection: 'column', gap: '12px' } },
    h('label', {}, 'twitter link', h('input', { name: 'twitter', placeholder: '(optional)' })),
    h('label', {}, 'telegram link', h('input', { name: 'telegram', placeholder: '(optional)' })),
    h('label', {}, 'website', h('input', { name: 'website', placeholder: '(optional)' })));
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (!f) { imageData = null; preview.replaceChildren(); return; }
    if (f.size > 1_000_000) { err.textContent = 'image must be under 1MB'; file.value = ''; return; }
    const r = new FileReader();
    r.onload = () => { imageData = r.result; preview.replaceChildren(h('img', { class: 'thumb preview-img', src: imageData, alt: '' })); };
    r.readAsDataURL(f);
  });

  const form = h('form', { class: 'form' },
    h('a', { href: '/', 'data-link': true, class: 'center' }, '[go back]'),
    h('label', {}, 'name', h('input', { name: 'name', required: true, maxlength: 32 })),
    h('label', {}, 'ticker', h('input', { name: 'ticker', required: true, maxlength: 10 })),
    h('label', {}, 'description', h('textarea', { name: 'description', rows: 4, maxlength: 500 })),
    h('label', {}, 'image', file), preview,
    h('a', { class: 'more', onclick: () => { extra.style.display = extra.style.display === 'none' ? 'flex' : 'none'; } }, 'show more options ↓'),
    extra,
    h('label', {}, 'buy your own coin first (optional, SOL)', h('input', { name: 'initialBuy', placeholder: '0.0', inputmode: 'decimal' })),
    h('p', { class: 'muted small' }, 'tip: coins graduate when the bonding curve sells out (~85 SOL). creating a coin is free; you only pay for your initial buy.'),
    err,
    h('button', { class: 'btn green', type: 'submit' }, 'create coin'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const f = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const data = await api('/api/coins', {
        body: {
          name: f.get('name'), ticker: f.get('ticker'), description: f.get('description'), image: imageData,
          twitter: f.get('twitter'), telegram: f.get('telegram'), website: f.get('website'), initialBuy: f.get('initialBuy') || '',
        },
      });
      ME = data.me;
      renderAccount();
      navigate('/coin/' + data.coin.id);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
  app.append(form);
}

// ---------- coin page ----------

function renderCoin(app, id) {
  let data = null;
  let side = 'buy';
  let slippage = Number(localStorage.getItem('slippage') || 5);
  let tab = 'thread';
  let interval = 60_000;
  let chartTrades = [];

  const head = h('div', { class: 'coin-head' });
  const canvas = h('canvas');
  const chartTools = h('div', { class: 'chart-tools' });
  const tabsEl = h('div', { class: 'tabs' });
  const tabBody = h('div');
  const tradeBox = h('div', { class: 'trade-box' });
  const infoBox = h('div', { class: 'info' });
  const holdersBox = h('div', { class: 'holders' });

  app.append(h('a', { href: '/', 'data-link': true, class: 'center', style: { display: 'block', marginBottom: '12px' } }, '[go back]'),
    h('div', { class: 'coin-page' },
      h('div', {}, head, h('div', { class: 'chart-wrap' }, chartTools, canvas), tabsEl, tabBody),
      h('div', { class: 'side-panel' }, tradeBox, infoBox, holdersBox)));

  async function load() {
    const [d, t] = await Promise.all([api('/api/coins/' + id), api(`/api/coins/${id}/trades`)]);
    data = d;
    chartTrades = t.trades;
    paintAll();
  }

  function paintAll() {
    paintHead();
    paintChartTools();
    drawChart();
    paintTabs();
    paintTrade();
    paintInfo();
    paintHolders();
  }

  function paintHead() {
    const c = data.coin;
    head.replaceChildren(
      h('span', { class: 'name' }, c.name),
      h('span', { class: 'muted' }, 'ticker: ', c.ticker),
      h('span', { class: 'green-t' }, 'Market cap: ', usd(c.marketCapUsd)),
      h('span', { class: 'muted' }, 'replies: ', c.replyCount),
      h('span', { class: 'muted' }, 'created by ', userLink(c.creator), ' ', ago(c.createdAt)),
      c.complete ? h('span', { class: 'badge grad' }, 'graduated') : null,
    );
  }

  function paintChartTools() {
    chartTools.replaceChildren(...[[60_000, '1m'], [300_000, '5m'], [900_000, '15m'], [3_600_000, '1h']].map(([ms, label]) =>
      h('button', { class: ms === interval ? 'on' : '', onclick: () => { interval = ms; paintChartTools(); drawChart(); } }, label)));
    chartTools.append(h('span', { class: 'muted small', style: { marginLeft: 'auto' } }, 'market cap (USD)'));
  }

  function drawChart() {
    drawCandles(canvas, chartTrades, interval, data.coin.createdAt);
  }

  function paintTabs() {
    tabsEl.replaceChildren(...[['thread', 'thread'], ['trades', 'trades']].map(([k, label]) =>
      h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; paintTabs(); } }, label)));
    tabBody.replaceChildren(tab === 'thread' ? threadView() : tradesView());
  }

  function threadView() {
    const c = data.coin;
    const box = h('div', { class: 'thread' },
      h('div', { class: 'post op' }, coinImg(c, 'thumb'),
        h('div', {}, h('div', { class: 'hdr' }, userLink(c.creator), ' (dev) ', ago(c.createdAt)), h('b', {}, c.name, ' (ticker: ', c.ticker, ')'), h('div', {}, c.description))),
      ...data.comments.map((cm) => h('div', { class: 'post' }, h('div', { class: 'hdr' }, userLink(cm.user), cm.user === c.creator ? ' (dev) ' : ' ', ago(cm.ts)), cm.text)));
    const ta = h('textarea', { rows: 3, maxlength: 500, placeholder: 'post a reply' });
    box.append(h('div', { class: 'reply-box' }, ta, h('button', {
      class: 'btn green',
      onclick: async () => {
        if (!requireLogin()) return;
        try {
          await api(`/api/coins/${id}/comments`, { body: { text: ta.value } });
          ta.value = '';
        } catch (e) { toast(e.message, true); }
      },
    }, 'post a reply')));
    return box;
  }

  function tradesView() {
    if (!data.trades.length) return h('p', { class: 'muted' }, 'no trades yet.');
    return h('table', { class: 'trades' },
      h('thead', {}, h('tr', {}, h('th', {}, 'account'), h('th', {}, 'type'), h('th', {}, 'SOL'), h('th', {}, data.coin.ticker), h('th', {}, 'date'))),
      h('tbody', {}, ...data.trades.map((t) => h('tr', {},
        h('td', {}, userLink(t.user)),
        h('td', { class: t.side === 'buy' ? 'green-t' : 'red-t' }, t.side),
        h('td', {}, solFmt(t.sol)),
        h('td', {}, num(t.tokens)),
        h('td', { class: 'muted' }, ago(t.ts))))));
  }

  function paintTrade() {
    const c = data.coin;
    tradeBox.replaceChildren();
    if (c.complete) {
      tradeBox.append(h('p', {}, '🎓 this coin graduated! the bonding curve sold out and trading on the curve is closed.'));
      return;
    }
    const input = h('input', { inputmode: 'decimal', placeholder: '0.0' });
    const quoteEl = h('div', { class: 'muted small' }, ' ');
    const err = h('p', { class: 'error' });
    let lastQuote = null;
    let qTimer = null;

    async function quote() {
      lastQuote = null;
      const v = input.value.trim();
      if (!v || Number(v) <= 0) { quoteEl.textContent = ' '; return; }
      try {
        const q = await api(`/api/coins/${id}/quote?side=${side}&amount=${encodeURIComponent(v)}`);
        if (input.value.trim() !== v) return;
        lastQuote = q;
        quoteEl.textContent = side === 'buy' ? `you receive ≈ ${num(Number(q.receive))} ${c.ticker} (fee ${solFmt(q.fee)} SOL)` : `you receive ≈ ${solFmt(Number(q.receive))} SOL (fee ${solFmt(q.fee)} SOL)`;
      } catch (e) { quoteEl.textContent = e.message; }
    }
    input.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(quote, 200); });

    const setAmt = (v) => { input.value = v; quote(); };
    const quick = side === 'buy'
      ? [h('button', { onclick: () => setAmt('') }, 'reset'), ...['0.1', '0.5', '1'].map((v) => h('button', { onclick: () => setAmt(v) }, v + ' SOL')),
        h('button', { onclick: () => setAmt(ME ? String(Math.max(0, Math.floor(ME.balance * 1e4) / 1e4)) : '') }, 'max')]
      : [h('button', { onclick: () => setAmt('') }, 'reset'), ...[25, 50, 75, 100].map((p) => h('button', { onclick: () => setAmt(String(Math.floor(data.myTokens * p / 100 * 1e6) / 1e6)) }, p + '%'))];

    const slipInput = h('input', { value: slippage, style: { width: '64px', padding: '2px 6px' }, inputmode: 'decimal' });
    slipInput.addEventListener('change', () => {
      slippage = Math.max(0, Math.min(50, Number(slipInput.value) || 0));
      slipInput.value = slippage;
      localStorage.setItem('slippage', slippage);
    });

    tradeBox.append(
      h('div', { class: 'toggle' },
        h('button', { class: 'buy' + (side === 'buy' ? ' on buy' : ''), onclick: () => { side = 'buy'; paintTrade(); } }, 'Buy'),
        h('button', { class: 'sell' + (side === 'sell' ? ' on sell' : ''), onclick: () => { side = 'sell'; paintTrade(); } }, 'Sell')),
      h('div', { class: 'small muted', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        side === 'buy' ? `balance: ${ME ? solFmt(ME.balance) : 0} SOL` : `balance: ${num(data.myTokens)} ${c.ticker}`,
        h('span', {}, 'slippage % ', slipInput)),
      h('div', { class: 'amount-row' }, input, h('span', { class: 'unit' }, side === 'buy' ? 'SOL' : c.ticker)),
      h('div', { class: 'quick' }, ...quick),
      quoteEl,
      err,
      h('button', {
        class: 'btn ' + (side === 'buy' ? 'green' : 'red'),
        onclick: async (e) => {
          if (!requireLogin()) return;
          err.textContent = '';
          e.target.disabled = true;
          try {
            if (!lastQuote) await quote();
            const res = await api(`/api/coins/${id}/trade`, {
              body: { side, amount: input.value.trim(), slippageBps: Math.round(slippage * 100), expected: lastQuote ? lastQuote.receive : undefined },
            });
            ME = res.me;
            data.myTokens = res.me.holdings[id] || 0;
            renderAccount();
            toast(`${side === 'buy' ? 'bought' : 'sold'} ${num(res.trade.tokens)} ${c.ticker} for ${solFmt(res.trade.sol)} SOL`);
            input.value = '';
            quoteEl.textContent = ' ';
            lastQuote = null;
          } catch (ex) {
            err.textContent = ex.message;
          } finally {
            e.target.disabled = false;
          }
        },
      }, 'place trade'));
  }

  function paintInfo() {
    const c = data.coin;
    const links = Object.entries(c.links || {}).filter(([, v]) => v);
    infoBox.replaceChildren(
      links.length ? h('div', { class: 'links' }, ...links.map(([k, v]) => h('a', { href: v, target: '_blank', rel: 'noopener noreferrer nofollow' }, '[', k, ']'))) : null,
      h('div', { class: 'row' }, coinImg(c, 'thumb'), h('div', {}, h('b', {}, c.name, ' (ticker: ', c.ticker, ')'), h('div', { class: 'muted small' }, c.description))),
      h('div', { class: 'small' }, 'bonding curve progress: ', c.progress.toFixed(1), '%'),
      h('div', { class: 'progress' }, h('div', { style: { width: c.progress + '%' } })),
      h('div', { class: 'muted small' }, c.complete
        ? 'the bonding curve sold out and this coin graduated.'
        : `when the market cap reaches ~${usd(graduationMcapUsd())} all the liquidity from the bonding curve graduates. there are ${num(c.tokensLeft)} tokens still available for sale in the bonding curve and ${solFmt(c.realSol)} SOL in the bonding curve.`),
      c.kothAt
        ? h('div', { class: 'small', style: { color: 'var(--yellow)' } }, '👑 crowned king of the hill ', ago(c.kothAt))
        : h('div', { class: 'muted small' }, 'king of the hill progress: ', Math.min(100, c.progress * 2).toFixed(0), '%'));
  }

  function paintHolders() {
    holdersBox.replaceChildren(h('b', {}, 'holder distribution'),
      h('ol', {}, ...data.holders.map((x) => h('li', {},
        h('span', {}, x.curve ? 'bonding curve 🏦' : userLink(x.name), x.name === data.coin.creator ? ' (dev)' : ''),
        h('span', {}, x.pct.toFixed(2), '%')))));
  }

  const onResize = () => data && drawChart();
  window.addEventListener('resize', onResize);
  view.cleanup = () => window.removeEventListener('resize', onResize);

  view.onEvent = (ev) => {
    if (!data) return;
    if (ev.type === 'trade' && ev.trade.coinId === id) {
      data.coin = ev.coin;
      data.trades.unshift(ev.trade);
      chartTrades.push({ ts: ev.trade.ts, price: ev.trade.price, side: ev.trade.side, sol: ev.trade.sol });
      paintHead();
      drawChart();
      if (tab === 'trades') paintTabs();
      paintInfo();
      // Refresh holder list and the trade box (curve may have completed).
      api('/api/coins/' + id).then((d) => { data.holders = d.holders; data.myTokens = d.myTokens; paintHolders(); if (d.coin.complete) paintTrade(); }).catch(() => {});
    } else if (ev.type === 'comment' && ev.coinId === id) {
      data.comments.push(ev.comment);
      data.coin.replyCount++;
      paintHead();
      if (tab === 'thread') paintTabs();
    }
  };

  load().catch((e) => app.replaceChildren(h('p', { class: 'center' }, e.message)));
}

// Market cap at which the curve sells out: 793.1M tokens sold from a 30 SOL / 1.073B virtual pool.
function graduationMcapUsd() {
  const k = 30 * 1_073_000_000;
  const vt = 1_073_000_000 - 793_100_000;
  const vs = k / vt;
  return (vs / vt) * TOTAL_SUPPLY * SOL_USD;
}

function drawCandles(canvas, trades, interval, createdAt) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const ht = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = ht * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, ht);

  const toMc = (p) => p * TOTAL_SUPPLY * SOL_USD;
  const candles = [];
  let prev = toMc(INITIAL_PRICE);
  for (const t of trades) {
    const bucket = Math.floor(t.ts / interval) * interval;
    const v = toMc(t.price);
    let c = candles[candles.length - 1];
    if (!c || c.t !== bucket) {
      c = { t: bucket, o: prev, h: prev, l: prev, c: prev };
      candles.push(c);
    }
    c.c = v;
    c.h = Math.max(c.h, v);
    c.l = Math.min(c.l, v);
    prev = v;
  }
  if (!candles.length) {
    const b = Math.floor(createdAt / interval) * interval;
    candles.push({ t: b, o: prev, h: prev, l: prev, c: prev });
  }

  const padR = 64, padB = 22, padT = 10;
  const maxBars = Math.max(10, Math.floor((w - padR) / 9));
  const shown = candles.slice(-maxBars);
  let lo = Math.min(...shown.map((c) => c.l));
  let hi = Math.max(...shown.map((c) => c.h));
  if (hi - lo < hi * 0.02) { hi *= 1.01; lo *= 0.99; }
  const y = (v) => padT + (hi - v) / (hi - lo) * (ht - padT - padB);
  const slot = (w - padR) / Math.max(shown.length, 30);
  const bw = Math.max(2, slot * 0.7);

  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.strokeStyle = '#2f3240';
  ctx.fillStyle = '#9ca3af';
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
    ctx.fillText(usd(v), w - padR + 6, yy + 4);
  }
  shown.forEach((c, i) => {
    const x = i * slot + slot / 2;
    const up = c.c >= c.o;
    ctx.strokeStyle = ctx.fillStyle = up ? '#4ade80' : '#f87171';
    ctx.beginPath(); ctx.moveTo(x, y(c.h)); ctx.lineTo(x, y(c.l)); ctx.stroke();
    const top = y(Math.max(c.o, c.c));
    ctx.fillRect(x - bw / 2, top, bw, Math.max(1, y(Math.min(c.o, c.c)) - top));
  });
  ctx.fillStyle = '#9ca3af';
  const step = Math.max(1, Math.ceil(shown.length / 6));
  shown.forEach((c, i) => {
    if (i % step) return;
    const d = new Date(c.t);
    ctx.fillText(d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'), i * slot + 2, ht - 6);
  });
}

// ---------- profile ----------

async function renderProfile(app, name) {
  let data;
  try { data = await api('/api/users/' + encodeURIComponent(name)); } catch (e) { app.append(h('p', { class: 'center' }, e.message)); return; }
  const isMe = ME && ME.name.toLowerCase() === data.user.name.toLowerCase();
  const total = data.held.reduce((s, x) => s + x.valueSol, 0);
  app.append(
    h('div', { class: 'profile-head' },
      h('h2', {}, '@', data.user.name),
      h('div', { class: 'muted' }, 'joined ', ago(data.user.createdAt)),
      isMe ? h('div', {}, 'balance: ', solFmt(ME.balance), ' SOL · holdings value ≈ ', solFmt(total), ' SOL') : null),
    h('h3', { class: 'center' }, 'coins held'),
    h('div', { class: 'holdings' }, data.held.length ? data.held.map((x) => h('a', { class: 'holding', href: '/coin/' + x.coin.id, 'data-link': true },
      coinImg(x.coin, ''), h('div', { class: 'grow' }, h('b', {}, x.coin.ticker), ' ', h('span', { class: 'muted' }, x.coin.name)),
      h('div', {}, num(x.tokens), ' ', x.coin.ticker), h('div', { class: 'green-t' }, solFmt(x.valueSol), ' SOL'))) : h('p', { class: 'muted center' }, 'nothing yet.')),
    h('h3', { class: 'center' }, 'coins created'),
    h('div', { class: 'grid' }, data.created.length ? data.created.map((c) => coinCard(c)) : h('p', { class: 'muted center' }, 'nothing yet.')),
  );
}

// ---------- how it works ----------

function renderHow(app) {
  app.append(h('div', { class: 'prose' },
    h('h2', { class: 'center' }, 'how it works'),
    h('p', {}, 'pump.work is a play-money replica of pump.fun. every coin is a fair launch: no presale, no team allocation — everyone buys from the same bonding curve.'),
    h('ol', {},
      h('li', {}, 'sign up and get 10 play SOL (plus 5 more from the faucet every hour).'),
      h('li', {}, 'pick a coin you like, or start your own for free.'),
      h('li', {}, 'buy on the bonding curve — the price rises as more of the 793.1M curve tokens are sold.'),
      h('li', {}, 'sell any time to lock in profits or losses. every trade pays a 1% fee.'),
      h('li', {}, `once a coin passes 50% of its curve it can become king of the hill. when the curve sells out (~85 SOL, ≈${usd(graduationMcapUsd())} market cap) the coin graduates and curve trading closes.`)),
    h('p', { class: 'muted small' }, 'nothing here is real: no wallets, no blockchain, no money. SOL prices are shown at a fixed $', String(SOL_USD), ' for flavour.'),
    h('p', { class: 'center' }, h('a', { href: '/', 'data-link': true, class: 'btn green' }, "i'm ready to pump"))));
}

// ---------- boot ----------

(async function boot() {
  try {
    const d = await api('/api/me');
    ME = d.me;
    SOL_USD = d.solUsd;
  } catch { /* offline */ }
  renderAccount();
  render();
  connectStream();
  setInterval(renderAccount, 60_000);
})();
