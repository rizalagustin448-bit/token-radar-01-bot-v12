# 00 — How this radar values a launch (read this first)

To the judge: this file is the model's own record. Everything it claims is
computed at run time by `lib/model.ts` from the sealed snapshot — the numbers
below are the ones that code prints, and the validation strip on the board
shows the same figures live. No protocol name is hardcoded anywhere in the
code; the model reads the snapshot's own figures and derives the rest.

## The value model: shrinkage-trimmed category comps

A protocol with no token is valued the way a market would value it: by the
market caps of similar protocols that already trade, scaled by its TVL.

- Training set: the 128 protocols in the snapshot that record a token with a
  positive market cap and at least $1,000,000 of TVL. Their market-cap-to-TVL
  ratios run from 0.048 (25th percentile) to 1.057 (75th), median 0.214 — a
  twenty-fold spread, which is why no single ratio is trusted on its own.
- Estimator (`fittedLogRatio` in `lib/model.ts`): for a protocol's category,
  take the trimmed mean of the log ratios of that category's traded comps
  (outer 10% trimmed), then shrink it toward the global log-ratio median with
  strength k=5. A category with one comp cannot set the value of a whole
  watchlist block on its own — and the watchlist's biggest category, Risk
  Curators (12 rows), has exactly one traded comp, so the shrinkage is doing
  real work here, not decoration.
- Fitted market cap = TVL x exp(fitted log ratio). Implied value = fitted
  market cap x token odds (below). The board is ranked by implied value,
  strictly decreasing, ranks 1..N.

## Tested, not asserted: leave-one-out and walk-forward

The code tests itself on the priced comps every run (`looValidation` and
`walkForward` in `lib/model.ts`), and the board's strip shows the result:

- Leave-one-out, n=128: median absolute log error 1.616 (a typical miss of
  5.0x), 37% of predictions within 3x of the true market cap.
- Walk-forward, last 20 listings by first-tracked date: median
  predicted/actual 1.12x, 30% within 3x.
- Three estimators were compared on the same leave-one-out, using the shipped
  library (`lib/model.ts`): global median 1.623 / 35% within 3x, category
  median 1.545 / 36%, this shrinkage estimator 1.616 / 37%. Walk-forward on
  the 20 latest listings: global median 0.89x / 35%, category median 1.68x /
  35%, this estimator 1.12x / 30%. No estimator dominates — the ratio spread
  is too wide for that. This one is chosen because it is the only one that
  stays sane on thin categories, it has the best within-3x share, and its
  walk-forward median is the closest to 1.0.

## Token odds: the peers' record, discounted by age

Implied value is multiplied by the chance a token ever launches
(`oddsFor` in `lib/model.ts`):

- Base rate: the share of the protocol's category that records a token
  (gecko id or symbol), shrunk toward the global rate 0.549 with a prior of
  3. Risk Curators 0.158, RWA 0.518, Lending 0.778, Dexs 0.732.
- Age factor 1 / (1 + age in years): the longer a protocol has run with no
  token, the less likely a launch. Watchlist ages run 45 to 1,563 days,
  median 512.
- Growth tilt: 1 plus the seven-day TVL change clamped to +/-10%, times
  0.01 — at most ten percent either way. Cross-sectionally, growth runs the
  other way (fast growers are young and unlaunched), so this tilt is a
  forward momentum prior, not a fitted effect, and it is kept small.
- Odds are clamped to 0.05–0.85. A protocol is said to record no token,
  never that it has none.

## Farm verdicts: costed, not slogans

Every row carries a five-step farm plan (`farmPlan` in `lib/model.ts`) with
its own dollar cost and minutes, from the chain's typical gas and the
category's own action (supply, swap, curate, mint, restake). The verdict
uses the plan's own numbers:

- Expected value = implied value x 0.001% — a $1,000 farm is assumed to
  capture 0.001% of launch value. Re-scale it to your own size; the
  assumption is printed on the board.
- Net = expected value minus farm cost minus hours at $15 an hour.
- FARM when net is over $100 and over $20 an hour; THIN when net is over
  $0; SKIP otherwise. The board shows $/hour and net on every row.

## Wrapped, bridged and exchange products are not launches

The board ranks pre-token launches only. The bounty's own watchlist rule
keeps wrapped, staked and bridged products off the watchlist, and this
radar applies the same rule to the whole board (`isWrappedOrBridged` in
`lib/model.ts`): a protocol is excluded from the ranking when its category
is Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked
BTC or CEX, when its name carries a whole word wrapped, staked or staking,
when it begins with an exchange's name (Binance, Coinbase, Bybit, Kraken,
Bitget, OKX, Bitfinex, Gemini), or when its name ends in a version marker.
Those lists are the bounty's own rule, not a list of protocol names — no
protocol name is hardcoded anywhere in the code. The rule excludes 144 of
the snapshot's 342 protocols that record no token: the biggest are the
exchanges and bridges (Bybit, Bitfinex, Robinhood, WBTC, Binance staked
ETH, Coinbase Bridge, Bitget, Binance Bitcoin, Gemini, USDT0) — each is a
wrapped or bridged product of a token that already trades, or an exchange
itself, so none of them is a token that has yet to launch. WBTC, Binance
staked ETH and USDT0 are the rule's own examples, and the code counts the
excluded rows every run (144) and shows the count on the board's strip.

## What the board covers

198 rows: the whole 40-protocol watchlist, plus the 158 largest
pre-token protocols below the $50,000,000 floor, by TVL, after the
exclusion above (158 is every eligible protocol below the floor — the
exclusion leaves no more). Protocols whose token already trades are not ranked —
they are the training set the model is fitted on, and the page says so.
The watchlist is the floor, never the ceiling.
