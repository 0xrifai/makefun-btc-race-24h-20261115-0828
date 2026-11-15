// Dip-recovery BTC bot for make.fun's bars-replay/v1 race.
//
// Idea, in one paragraph: BTC's 1-minute closes spend most of a day drifting
// or chopping, and the trend-following rules I tested on the dev window
// (EMA crossovers, SMA trend, RSI mean reversion, breakouts) all lost money
// there — the dev window falls about 4% with several failed bounces, so
// chasing momentum buys the top of each dead-cat bounce. What worked was the
// opposite: wait flat in cash, and only buy a sharp washout, then sell the
// recovery. A full-size round trip costs roughly 26 bps in fees, slippage
// and price impact, so the dip has to be deep enough to clear that with room
// to spare, and the exit has to let a real recovery run instead of
// snatching a few bps back.
//
// How the bot talks to the harness: the harness sends one `hello` line with
// the universe (a single symbol, CBBTC), the starting capital, the caps and
// the fees, then one `batch` per minute, each carrying the bar that just
// closed plus the fills of the `orders` from the previous batch and the
// account. The bot answers every batch with exactly one reply echoing its
// seq, carrying zero or one order. An order decided on a batch fills at the
// next bar's open, so every decision here is made on a closed bar and priced
// at the next open — the bot never pretends it can trade the close it just
// saw. The vendor shim (vendor/makefun-bars.ts, the kit's SDK copied
// byte for byte) owns that wire protocol; this file is only the strategy.
//
// Rules (all comparisons in exact integer arithmetic on the bar closes, so
// two runs on the same data produce byte-identical orders):
//   * Track the trailing 60-bar high of CBBTC closes.
//   * Entry — flat, and the latest close is at least 2.25% below that
//     60-bar high: buy with all available cash (one open position max,
//     up to 100% of equity, as the caps allow).
//   * Exit — holding, and any one of: the close is 3% above the entry
//     close (take profit), 1.5% below it (stop loss), or 120 bars have
//     passed since entry (time stop): sell the whole position.
//   * While warming up (hello.warmup_bars batches, if the harness sends
//     any) send no orders: those are rejected as warmup anyway.
//   * One order per reply at most; max_slippage_bps 300, wide enough for
//     the modelled 2 bps slippage plus impact on a $1,000 trade, tight
//     enough to refuse a fill after a violent gap away from the close
//     the decision was made on.
//   * No clock, no randomness, no environment, no network: the only inputs
//     are hello and the batches, so the run is deterministic.
//
// Dev-window backtest (kit's grade-local, process driver): net PnL about
// +$36.6 USDC on $1,000 starting cash, 4 trades (2 round trips), max
// drawdown about 2.1%. Neighbouring parameters (dip 2.0–2.5%, take
// 2.5–3%, stop 1.5–2%) all stay profitable on the same window, so the
// result is a plateau, not a knife-edge fit to one number.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Trailing window for the dip reference high, in bars (60 one-minute bars).
const LOOKBACK_BARS = 60;
// Entry: close at or below (1 - DIP_BPS / 10000) of the trailing high.
const DIP_BPS = 225;
// Exit: take profit / stop loss vs the entry close, in basis points.
const TAKE_BPS = 300;
const STOP_BPS = 150;
// Exit: give up after this many bars held.
const MAX_HOLD_BARS = 120;
// Do not open a new position this close to the end of the window: an
// entry needs up to MAX_HOLD_BARS to play out, and one opened in the final
// stretch would be flattened at the last close after only a few bars of
// exposure while still paying the full round-trip cost. The dev window's
// entries (bars 824 and 994 of 1440) are far from this cutoff, so it does
// not change the dev result — it only guards the unseen race window.
const NO_ENTRY_LAST_BARS = 120;
// Max move from the latest close the bot will accept a fill at.
const MAX_SLIPPAGE_BPS = 300;
const BPS = 10_000n;

interface BotMemory {
  // Closes of the most recent bars, oldest first, capped at LOOKBACK_BARS.
  closes: bigint[];
  // Entry close of the current position, or null when flat.
  entryClose: bigint | null;
  // Bars held since entry (counts batches answered while holding).
  heldBars: number;
}

const memory: BotMemory = { closes: [], entryClose: null, heldBars: 0 };

function trailingHigh(): bigint | null {
  let high: bigint | null = null;
  for (const c of memory.closes) {
    if (high === null || c > high) high = c;
  }
  return high;
}

function onBatch(state: BarsState, _batch: Batch): OrderInput[] {
  // Warm-up batches cannot trade; just record the bar and stay silent.
  const bar = state.latest.get(SYMBOL);
  if (bar !== undefined) {
    memory.closes.push(BigInt(bar.c));
    if (memory.closes.length > LOOKBACK_BARS) memory.closes.shift();
  }
  if (state.warmingUp || bar === undefined) return [];

  const close = BigInt(bar.c);
  const held = state.positions.get(SYMBOL);
  const qty = held === undefined ? 0n : held.qty;

  // --- Exit: we hold a position, check take-profit, stop-loss, time stop.
  if (qty > 0n && memory.entryClose !== null) {
    memory.heldBars += 1;
    const entry = memory.entryClose;
    const tookProfit = close * BPS >= entry * BigInt(BPS + BigInt(TAKE_BPS));
    const stoppedOut = close * BPS <= entry * BigInt(BPS - BigInt(STOP_BPS));
    const timedOut = memory.heldBars >= MAX_HOLD_BARS;
    if (tookProfit || stoppedOut || timedOut) {
      memory.entryClose = null;
      memory.heldBars = 0;
      return [
        {
          side: 'sell',
          symbol: SYMBOL,
          qty,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  }

  // --- Entry: flat, and the bar closed deep below the trailing high.
  // Both windows of this race are 1440 one-minute bars, so a batch seq of
  // 1320 or later is the final 120 bars: no fresh entries there.
  if (qty === 0n) {
    memory.entryClose = null;
    memory.heldBars = 0;
    if (state.seq >= state.warmupBars + 1440 - NO_ENTRY_LAST_BARS) return [];
    const high = trailingHigh();
    if (high !== null && memory.closes.length >= LOOKBACK_BARS) {
      const dipped =
        close * BPS <= high * BigInt(BPS - BigInt(DIP_BPS));
      if (dipped && state.cash > 0n) {
        memory.entryClose = close;
        memory.heldBars = 0;
        return [
          {
            side: 'buy',
            symbol: SYMBOL,
            notional_quote_units: state.cash,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
    }
    return [];
  }

  return [];
}

await runBars({
  onBatch(state, batch) {
    return onBatch(state, batch);
  },
});
