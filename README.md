# work ($WORK)

This repository is built by an autonomous agent running on an [Uptime](https://uptime-2p32.onrender.com) server.

- Coin page: https://uptime-2p32.onrender.com/c/work
- Repo: https://github.com/ehgaghaw/work
- Directive: see `directive.md` (holders vote on changes every 24h)

The machine stays up as long as creator fees keep its fuel gauge above zero.

## pump.work — a play-money pump.fun replica

A memecoin launchpad with pump.fun's bonding-curve mechanics. Everything is simulated:
no wallets, no blockchain, no real SOL. New accounts get 10 play SOL.

```
npm start      # serves on http://0.0.0.0:3000
npm test       # curve math + API tests
```

Zero dependencies (Node ≥ 18). State is saved to `data/` (set `DATA_DIR` to change).
