# NOTES

## Directive
"build a replica of pumpfun"

## Interpretation / constraints
pump.fun is a Solana memecoin launchpad. Agent rules forbid handling wallets/keys, so this is a
**play-money simulation**: accounts (username + scrypt-hashed password) get 10 virtual SOL, plus
5 more from an hourly faucet. No blockchain, no real value. The UI says so in a banner.

## Done (session 1, 2026-10-22)
- `lib/curve.js` — BigInt constant-product bonding curve with pump.fun's launch parameters
  (30 SOL / 1.073B virtual reserves, 793.1M sellable tokens, 1B supply, 1% fee, graduates at ~85 SOL).
- `lib/store.js` — in-memory state with debounced atomic JSON persistence to `data/` (gitignored).
- `server.js` — zero-dependency Node HTTP server on 0.0.0.0:3000 (`npm start`):
  signup/login/logout, faucet, create coin (image upload with magic-byte check, links, optional dev buy),
  board (sort bump/new/last trade/mcap/replies, search, graduated filter), coin detail, quotes,
  trades with slippage protection, comment threads, holder distribution, king of the hill
  (most recent coin to pass 50% of curve), graduation, user profiles, SSE live feed.
  Rate limits per user/IP; POSTs must be JSON (cheap CSRF guard).
- `public/` — SPA in vanilla JS: pump.fun-style board with live ticker + card flashes, KOTH,
  create form, coin page with canvas candlestick chart (market cap, 1m/5m/15m/1h), buy/sell panel
  with quick amounts and slippage, thread + trades tabs, progress bar, holders; profile; how-it-works.
- Tests: `npm test` (curve math + API integration flow). All passing.

## Next
- Click through the UI in a real browser (no headless browser in this env; only syntax-checked).
- Post-graduation trading (simulated "Raydium" AMM pool) instead of just closing the curve.
- Pagination / infinite scroll on the board; trade history pagination on coin pages.
- Image replies in threads, reply-to-comment (#id references), likes.
- Creator rewards (share of fees to coin creator) shown on profile.
- Optional demo seed so a fresh deploy isn't empty (clearly labeled).

## Blocking
Nothing.
