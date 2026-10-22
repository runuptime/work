'use strict';
// Constant-product bonding curve modelled on pump.fun's launch parameters.
// All amounts are BigInt in base units: SOL in lamports (1e9), tokens with 6 decimals.

const LAMPORTS = 1_000_000_000n;
const TOKEN_UNIT = 1_000_000n;

const CURVE = {
  initialVirtualSol: 30n * LAMPORTS,
  initialVirtualTokens: 1_073_000_000n * TOKEN_UNIT,
  initialRealTokens: 793_100_000n * TOKEN_UNIT,
  totalSupply: 1_000_000_000n * TOKEN_UNIT,
  feeBps: 100n, // 1% on every trade, taken in SOL
};

function newCurve() {
  return {
    virtualSol: CURVE.initialVirtualSol,
    virtualTokens: CURVE.initialVirtualTokens,
    realSol: 0n,
    realTokens: CURVE.initialRealTokens,
    complete: false,
  };
}

function fee(lamports) {
  return (lamports * CURVE.feeBps + 9_999n) / 10_000n; // round up
}

// Quote a buy spending `solIn` lamports (fee included). Caps at the remaining curve supply.
function quoteBuy(c, solIn) {
  if (c.complete) throw new Error('curve complete');
  if (solIn <= 0n) throw new Error('amount must be positive');
  let feePaid = fee(solIn);
  let solToCurve = solIn - feePaid;
  let tokensOut = (solToCurve * c.virtualTokens) / (c.virtualSol + solToCurve);
  if (tokensOut >= c.realTokens) {
    // Buy out the rest of the curve and only charge what that costs.
    tokensOut = c.realTokens;
    solToCurve = ceilDiv(tokensOut * c.virtualSol, c.virtualTokens - tokensOut);
    feePaid = fee(solToCurve);
  }
  if (tokensOut <= 0n) throw new Error('amount too small');
  return { solIn: solToCurve + feePaid, solToCurve, fee: feePaid, tokensOut };
}

// Quote a sell of `tokensIn` base units. Returns SOL received after fee.
function quoteSell(c, tokensIn) {
  if (c.complete) throw new Error('curve complete');
  if (tokensIn <= 0n) throw new Error('amount must be positive');
  const gross = (tokensIn * c.virtualSol) / (c.virtualTokens + tokensIn);
  if (gross > c.realSol) throw new Error('insufficient curve liquidity');
  const feePaid = fee(gross);
  if (gross - feePaid <= 0n) throw new Error('amount too small');
  return { tokensIn, solGross: gross, fee: feePaid, solOut: gross - feePaid };
}

function applyBuy(c, q) {
  c.virtualSol += q.solToCurve;
  c.virtualTokens -= q.tokensOut;
  c.realSol += q.solToCurve;
  c.realTokens -= q.tokensOut;
  if (c.realTokens === 0n) c.complete = true;
}

function applySell(c, q) {
  c.virtualSol -= q.solGross;
  c.virtualTokens += q.tokensIn;
  c.realSol -= q.solGross;
  c.realTokens += q.tokensIn;
}

// Price in SOL per whole token, as a float for display.
function price(c) {
  return Number(c.virtualSol) / Number(LAMPORTS) / (Number(c.virtualTokens) / Number(TOKEN_UNIT));
}

function marketCapSol(c) {
  return price(c) * Number(CURVE.totalSupply / TOKEN_UNIT);
}

// Bonding curve progress, 0..100.
function progress(c) {
  const sold = CURVE.initialRealTokens - c.realTokens;
  return Number((sold * 10_000n) / CURVE.initialRealTokens) / 100;
}

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

// Parse a decimal string like "1.25" into base units. Rejects anything odd.
function parseUnits(str, decimals) {
  if (typeof str === 'number') str = String(str);
  if (typeof str !== 'string' || !/^\d{0,15}(\.\d*)?$/.test(str.trim()) || str.trim() === '' || str.trim() === '.') {
    throw new Error('invalid amount');
  }
  const [whole, frac = ''] = str.trim().split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
}

function formatUnits(v, decimals) {
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '');
}

module.exports = {
  LAMPORTS, TOKEN_UNIT, CURVE,
  newCurve, quoteBuy, quoteSell, applyBuy, applySell,
  price, marketCapSol, progress, parseUnits, formatUnits,
};
