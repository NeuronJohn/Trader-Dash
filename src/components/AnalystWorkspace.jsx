import React, { useMemo, useState } from "react";
import { Activity, BookOpen, BrainCircuit, ChartNoAxesCombined, ShieldAlert, Sparkles, Target, NotebookPen, Search, ExternalLink } from "lucide-react";
import { summarizeTrades, groupTrades, buildEvidenceFlags, formatR } from "../lib/analytics";

const percent = (v) => v == null ? "—" : (v * 100).toFixed(1) + "%";
const fmt = (v) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);
const light = "border border-white/10 bg-white/[0.035]";
const card = "rounded-2xl " + light + " p-4";
function Stat({ label, value, sub }) {
  return <div className={card}><p className="text-[11px] uppercase tracking-[.13em] text-zinc-400">{label}</p>
    <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">{value}</p>
    <p className="mt-1 text-xs text-zinc-500">{sub}</p></div>;
}
function Flag({ flag }) {
  return <div className="rounded-xl border border-white/10 bg-white/[.025] p-3">
    <p className="text-sm font-medium text-zinc-200">{flag.title}</p>
    <p className="mt-1 text-sm leading-6 text-zinc-400">{flag.detail}</p>
  </div>;
}
export default function AnalystWorkspace({ trades = [], onUpdateTrade }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [market, setMarket] = useState("All markets");
  const [mode, setMode] = useState("All entries");
  const markets = useMemo(() => ["All markets", ...new Set(trades.map(t => t.market).filter(Boolean))], [trades]);
  const filtered = useMemo(() => trades.filter(t =>
    (market === "All markets" || t.market === market) &&
    (mode === "All entries" || (mode === "Rule-following only" ? t.followedRules === true : t.followedRules === false)) &&
    [t.market, t.setup, t.thesis, t.mistake, t.tags, t.analystNotes].some(v => String(v || "").toLowerCase().includes(search.toLowerCase()))
  ), [trades, market, mode, search]);
  const stats = useMemo(() => summarizeTrades(filtered), [filtered]);
  const bySetup = useMemo(() => groupTrades(filtered, "setup"), [filtered]);
  const flags = useMemo(() => buildEvidenceFlags(filtered), [filtered]);
  const selected = filtered.find(t => t.id === selectedId) || filtered[0] || null;
  const last = [...filtered].sort((a,b) => (String(b.date||"") + String(b.time||"")).localeCompare(String(a.date||"") + String(a.time||"")));
  return <div className="space-y-4">
    <div className="rounded-[1.7rem] border border-white/10 bg-gradient-to-br from-[#141a24] to-[#0c1119] p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.15em] text-emerald-300"><BrainCircuit className="h-4 w-4"/> Evidence analyst</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">Your decisions, measured.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">An always-on local review of your journal: recurring errors, strategy splits, drawdowns, and observations. Insight is grounded in your own entries, not generated trading signals.</p>
        </div>
        <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-200">Live AI / charts not connected</div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3"><Search className="h-4 w-4 text-zinc-500"/><input aria-label="Search your trades and notes" className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-zinc-500" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search setups, tags, notes..." /></label>
        <select aria-label="Filter market" className="rounded-xl border border-white/10 bg-[#171d27] px-3 py-3 text-sm text-zinc-200" value={market} onChange={e => setMarket(e.target.value)}>{markets.map(m => <option key={m}>{m}</option>)}</select>
        <select aria-label="Filter rule adherence" className="rounded-xl border border-white/10 bg-[#171d27] px-3 py-3 text-sm text-zinc-200" value={mode} onChange={e => setMode(e.target.value)}>{["All entries","Rule-following only","Rule breaks only"].map(m => <option key={m}>{m}</option>)}</select>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Logged trades" value={stats.count} sub={stats.missingResults ? stats.missingResults + " missing outcomes" : "With numeric results"} />
      <Stat label="Expectancy" value={formatR(stats.expectancyR)} sub="Self-reported mean per trade"/>
      <Stat label="Win rate" value={percent(stats.winRate)} sub="Not a profitability guarantee" />
      <Stat label="Maximum drawdown" value={fmt(stats.maxDrawdownR) + "R"} sub="From recorded sequence"/>
      <Stat label="Profit factor" value={fmt(stats.profitFactor)} sub="Gross wins / gross losses" />
      <Stat label="Rule adherence" value={percent(stats.ruleAdherence)} sub="Self-reported compliance" />
      <Stat label="Longest losing streak" value={stats.longestLossStreak} sub="Consecutive losing trades" />
      <Stat label="Completed net R" value={formatR(stats.totalR)} sub="Before unrecorded trading costs" />
    </div>

    <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
      <section className={card}>
        <div className="mb-4 flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-300"/><h3 className="font-semibold text-zinc-100">Observations worth reviewing</h3></div>
        <div className="space-y-2">{flags.map((flag,i) => <Flag key={flag.kind + i} flag={flag}/>)}</div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">Automated statistical observations only. No model-generated chart interpretation or live price monitoring is active in this build.</p>
      </section>
      <section className={card}>
        <div className="mb-4 flex items-center gap-2"><ChartNoAxesCombined className="h-4 w-4 text-cyan-300"/><h3 className="font-semibold text-zinc-100">Setup comparison</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm"><thead className="text-xs text-zinc-500"><tr className="border-b border-white/10"><th className="pb-3 pr-2 font-medium">Setup</th><th className="pb-3 pr-2 font-medium">Trades</th><th className="pb-3 pr-2 font-medium">Win %</th><th className="pb-3 font-medium">Mean R</th></tr></thead>
          <tbody>{bySetup.map(x => <tr key={x.label} className="border-b border-white/5 text-zinc-300"><td className="py-3 pr-2">{x.label}</td><td className="py-3 pr-2 tabular-nums">{x.count}</td><td className="py-3 pr-2 tabular-nums">{percent(x.winRate)}</td><td className="py-3 tabular-nums">{formatR(x.expectancyR)}</td></tr>)}</tbody></table>
          {!bySetup.length && <p className="py-6 text-sm text-zinc-500">No matching trades yet. Record a setup and outcome to populate this comparison.</p>}
        </div>
        <div className="mt-4 rounded-xl bg-white/[.03] p-3 text-xs leading-5 text-zinc-400">Future research features: out-of-sample split, replay comparison, transaction-cost modeling, confidence intervals, strategy versions, and matched historical setups.</div>
      </section>
    </div>

    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><NotebookPen className="h-4 w-4 text-violet-300"/><h3 className="font-semibold text-zinc-100">Review & private notes</h3></div>
        <span className="text-xs text-zinc-500">Notes save automatically to your local trade journal</span>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,270px)_1fr]">
        <div className="max-h-80 space-y-2 overflow-auto">{last.map(t => <button type="button" key={t.id} onClick={() => setSelectedId(t.id)} className={"w-full rounded-xl border p-3 text-left transition " + (selected?.id === t.id ? "border-emerald-400/30 bg-emerald-400/[.07]" : "border-white/10 bg-white/[.025] hover:bg-white/[.06]")}>
          <div className="flex justify-between gap-3 text-sm text-zinc-200"><span className="font-medium">{t.market || "Trade"}</span><span className="tabular-nums">{formatR(Number(t.resultR))}</span></div>
          <div className="mt-1 text-xs text-zinc-500">{t.date || "Undated"} · {t.setup || "Unclassified"}</div>
        </button>)}</div>
        {selected ? <div className="space-y-3">
          <p className="text-sm font-medium text-zinc-200">{selected.setup || "Unclassified setup"} · {selected.direction || "Direction unrecorded"}</p>
          <p className="text-xs text-zinc-400">Thesis: {selected.thesis || "No original thesis recorded"}</p>
          <p className="text-xs text-zinc-400">Mistake: {selected.mistake || "No mistake recorded"}</p>
          {selected.screenshotUrl && <a className="inline-flex items-center gap-1 text-xs text-emerald-300 underline" target="_blank" rel="noreferrer" href={selected.screenshotUrl}>Open linked screenshot <ExternalLink className="h-3 w-3"/></a>}
          <label className="block text-xs font-medium text-zinc-300" htmlFor="analyst-notes">Detailed notes and observations</label>
          <textarea id="analyst-notes" rows={6} value={selected.analystNotes || ""} onChange={e => onUpdateTrade?.(selected.id, { analystNotes: e.target.value })} placeholder="What did price do? Why did you enter? What did you overlook? Add ideas for a future experiment..." className="w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-400/40"/>
        </div> : <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">Log a trade to open its review notebook.</div>}
      </div>
    </section>
  </div>;
}
