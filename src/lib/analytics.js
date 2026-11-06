// Deterministic analytics over v13 manual journal entries.
// These are descriptive, not validated edge or realized net brokerage performance.
const validR = (trade) => trade?.resultR !== "" && trade?.resultR != null && Number.isFinite(Number(trade.resultR));
const getR = (trade) => Number(trade.resultR);

export function summarizeTrades(source = []) {
  const trades = source.filter(validR);
  const n = trades.length;
  const winners = trades.filter((trade) => getR(trade) > 0);
  const losers = trades.filter((trade) => getR(trade) < 0);
  const grossWins = winners.reduce((sum, t) => sum + getR(t), 0);
  const grossLosses = Math.abs(losers.reduce((sum, t) => sum + getR(t), 0));
  const totalR = grossWins - grossLosses;
  const ordered = [...trades].sort((a, b) => {
    const key = (t) => [t.date || "", t.time || "", t.id || ""].join("T");
    return key(a).localeCompare(key(b));
  });
  let peak = 0;
  let equity = 0;
  let maxDrawdownR = 0;
  let losingStreak = 0;
  let worstStreak = 0;
  for (const trade of ordered) {
    const r = getR(trade);
    equity += r;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
    losingStreak = r < 0 ? losingStreak + 1 : 0;
    worstStreak = Math.max(worstStreak, losingStreak);
  }
  const sumWins = winners.length;
  const sumLosses = losers.length;
  return {
    count: n,
    missingResults: source.length - n,
    wins: sumWins,
    losses: sumLosses,
    flat: n - sumWins - sumLosses,
    totalR,
    expectancyR: n ? totalR / n : null,
    winRate: n ? sumWins / n : null,
    avgWinnerR: sumWins ? grossWins / sumWins : null,
    avgLoserR: sumLosses ? -(grossLosses / sumLosses) : null,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
    maxDrawdownR,
    longestLossStreak: worstStreak,
    ruleAdherence: n ? trades.filter(t => t.followedRules === true).length / n : null,
    equityCurve: ordered.map(t => ({ id: t.id, date: t.date, r: getR(t) })),
  };
}

export function groupTrades(source = [], field = "market") {
  const groups = new Map();
  for (const t of source) {
    const name = String(t[field] || "Unclassified").trim() || "Unclassified";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(t);
  }
  return [...groups.entries()]
    .map(([label, trades]) => ({ label, ...summarizeTrades(trades) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildEvidenceFlags(trades = []) {
  const flags = [];
  const completed = trades.filter(validR);
  if (completed.length === 0) return [{ kind: "data", title: "Start with a trade", detail: "Log each result in R with the market, setup, rule compliance and a brief why." }];
  if (completed.length < 30) flags.push({kind:"sample",title:"Small sample",detail:"Fewer than 30 logged outcomes. Treat all edge estimates as highly uncertain."});
  const violations = completed.filter(t => t.followedRules === false);
  if (violations.length > 0) {
    const broke = summarizeTrades(violations);
    const obeyed = summarizeTrades(completed.filter(t => t.followedRules === true));
    flags.push({kind:"behavior",title:"Rule adherence",detail: String(violations.length) + " self-reported rule breaks; average " + formatR(broke.expectancyR) + " on rule-break trades versus " + formatR(obeyed.expectancyR) + " on rule-following trades. Correlation, not causation."});
  }
  const setups = groupTrades(completed, "setup");
  if (setups.length > 1) flags.push({kind:"breakdown",title:"Setup performance",detail: String(setups.length) + " named setups. Compare each separately; small groups are inconclusive."});
  const stats = summarizeTrades(completed);
  if (stats.maxDrawdownR >= 5) flags.push({kind:"risk",title:"Drawdown checkpoint",detail:"Maximum cumulative self-reported drawdown is " + stats.maxDrawdownR.toFixed(2) + "R. Review trade order and sizing before increasing risk."});
  flags.push({kind:"provenance",title:"Unverified inputs",detail:"Trades are entered manually. Fees, spread, slippage, raw fills, market data and out-of-sample validation are not yet audited."});
  return flags;
}

export function formatR(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "R";
}
