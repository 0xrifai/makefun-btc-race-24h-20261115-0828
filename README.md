# makefun-btc-race-24h-20261115-0828

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/0xrifai/makefun-btc-race-24h-20261115-0828/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/0xrifai/makefun-btc-race-24h-20261115-0828/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A BTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars, with $1,000 of paper money — nothing is traded for real.

Strategy: wait flat in cash and buy only a sharp washout — when the 1-minute close falls at least 2.25% below the trailing 60-bar high — then sell the recovery at +3% take-profit, −1.5% stop-loss, or after 120 bars. Trend-following rules (EMA cross, SMA trend, RSI, breakouts) all lost money on the falling dev window; buying deep dips and selling the bounce is what cleared the round-trip cost of ~26 bps.

Dev-window result (kit `grade-local`): net PnL about +$36.6 USDC, 4 trades, max drawdown about 2.1%.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1: newline-delimited JSON on stdin/stdout (`hello`, then one `batch` per bar, then `done`). Grade it locally with the kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot <this-repo> --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=6twtfdad&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
