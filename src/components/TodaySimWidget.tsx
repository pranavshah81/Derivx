import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, PlayCircle, TrendingUp, TrendingDown, Zap,
  ChevronDown, ChevronUp, ShieldAlert, Target, Clock, LogIn, LogOut,
} from "lucide-react";
import {
  fetchIntradayCandles,
  computeORB,
  detectAllEvents,
  sharesFor30K,
  SECTOR_STOCKS,
  type ORBEvent,
} from "@/hooks/useORBStrategy";
import { TradeDetailChart } from "@/components/TradeDetailChart";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SimResult {
  symbol: string;
  sector: string;
  changePercent: number;
  ltp930: number;
  orbHigh: number;
  orbLow: number;
  orbRangePct: number;
  direction: "bullish" | "bearish";
  hadBreakout: boolean;
  entryPrice: number | null;
  entryTime: number | null;     // unix seconds
  exitPrice: number | null;
  exitTime: number | null;      // unix seconds
  exitReason: "target_2x" | "sl_hit" | "cost_exit" | "open" | null;
  slPrice: number | null;
  target1: number | null;
  target2: number | null;
  shares: number;
  pnl: number | null;
  partialBooked: boolean;
  partialExitPrice: number | null;
  partialPnl: number | null;
}

// ── Snapshot loader ────────────────────────────────────────────────────────────

interface SnapshotStock {
  symbol: string;
  changePercent: number;
  ltp: number;
  sector?: string;
}

function loadTodaySnapshot(): { stocks: SnapshotStock[]; capturedAt: number } | null {
  const today = new Date().toISOString().slice(0, 10);
  try {
    for (const key of [`orb-930-base-${today}`, `orb-930-active-${today}`]) {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    }
  } catch { /* ignore */ }
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getSector(symbol: string): string {
  return Object.entries(SECTOR_STOCKS).find(([, s]) => s.includes(symbol))?.[0] ?? "Other";
}

function fmtTime(unixSec: number | null): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}

function fmtPrice(p: number | null, decimals = 2): string {
  return p != null ? `₹${p.toFixed(decimals)}` : "—";
}

// ── Parse outcome from detectAllEvents ────────────────────────────────────────

function parseOutcome(
  events: ORBEvent[],
  candles: { time: number; close: number; high: number; low: number }[],
  direction: "bullish" | "bearish",
): Omit<SimResult, "symbol" | "sector" | "changePercent" | "ltp930" | "orbHigh" | "orbLow" | "orbRangePct" | "direction"> {
  const lastCandle = candles[candles.length - 1];
  const lastClose = lastCandle?.close ?? 0;
  const lastTime  = lastCandle?.time ?? 0;
  const dir = direction === "bullish" ? 1 : -1;

  const noBreakout = {
    hadBreakout: false, entryPrice: null, entryTime: null,
    exitPrice: null, exitTime: null, exitReason: null as SimResult["exitReason"],
    slPrice: null, target1: null, target2: null,
    shares: 0, pnl: null, partialBooked: false, partialExitPrice: null, partialPnl: null,
  };

  if (!events.some(e => e.kind === "entry" || e.kind === "reentry")) return noBreakout;

  // Walk events sequentially, one coherent trade at a time.
  // Each trade lifecycle: entry/reentry → (target_1x?) → (target_3x?) → (sl_hit | end-of-day)
  let totalPnl = 0;
  let totalPartialPnl = 0;
  let hasAnyPartial = false;
  let lastPartialPrice: number | null = null;

  // Display fields — track the LAST completed (or active) trade
  let displayEntry: number | null = null;
  let displayEntryTime: number | null = null;
  let displayExit: number | null = null;
  let displayExitTime: number | null = null;
  let displayExitReason: SimResult["exitReason"] = null;
  let displaySL: number | null = null;
  let displayT1: number | null = null;
  let displayT2: number | null = null;
  let displayShares = 0;

  let activeEntry: number | null = null;
  let activeInitialSL: number | null = null;
  let activeT1: number | null = null;
  let activeT2: number | null = null;
  let activeShares = 0;
  let activeHalfShares = 0;
  let activeRemainShares = 0;
  let activeHit1x = false;
  let activeHit2x = false;

  for (const ev of events) {
    if (ev.kind === "entry" || ev.kind === "reentry") {
      const meta = ev.entryMeta!;
      // entryPrice is now stored in meta; fallback: initialSL + risk
      activeEntry = meta.entryPrice ?? (meta.initialSL + meta.risk);
      activeInitialSL = meta.initialSL;
      activeT1 = meta.target1;
      activeT2 = meta.target2;
      activeShares = sharesFor30K(activeEntry);
      activeHalfShares = Math.floor(activeShares / 2);
      activeRemainShares = activeShares - activeHalfShares;
      activeHit1x = false;
      activeHit2x = false;

      displayEntry = activeEntry;
      displayEntryTime = ev.signal.time;
      displaySL = activeInitialSL;
      displayT1 = activeT1;
      displayT2 = activeT2;
      displayShares = activeShares;
    } else if (ev.kind === "target_1x" && activeEntry !== null) {
      activeHit1x = true;
    } else if (ev.kind === "target_2x" && activeEntry !== null && activeT2 !== null) {
      activeHit2x = true;
      // Book 50% at T2
      const partial = dir * (activeT2 - activeEntry) * activeHalfShares;
      totalPnl += partial;
      totalPartialPnl += partial;
      hasAnyPartial = true;
      lastPartialPrice = activeT2;
    } else if (ev.kind === "sl_hit" && activeEntry !== null) {
      const exitPx = ev.signal.candle.close;
      // Remaining shares exit at SL
      const remaining = activeHit2x ? activeRemainShares : activeShares;
      totalPnl += dir * (exitPx - activeEntry) * remaining;
      displayExit = exitPx;
      displayExitTime = ev.signal.time;
      displayExitReason = activeHit1x ? "cost_exit" : "sl_hit";
      // Reset active trade — might be re-entered via sl_hit_bullish phase
      activeEntry = null;
    }
  }

  // If still in an active trade at end of day, exit at last close
  if (activeEntry !== null) {
    const remaining = activeHit2x ? activeRemainShares : activeShares;
    totalPnl += dir * (lastClose - activeEntry) * remaining;
    displayExit = lastClose;
    displayExitTime = lastTime;
    displayExitReason = "open";
  }

  return {
    hadBreakout: true,
    entryPrice: displayEntry,
    entryTime: displayEntryTime,
    exitPrice: displayExit,
    exitTime: displayExitTime,
    exitReason: displayExitReason,
    slPrice: displaySL,
    target1: displayT1,
    target2: displayT2,
    shares: displayShares,
    pnl: totalPnl,
    partialBooked: hasAnyPartial,
    partialExitPrice: lastPartialPrice,
    partialPnl: hasAnyPartial ? totalPartialPnl : null,
  };
}

// ── Simulation runner ──────────────────────────────────────────────────────────

async function runSimulation(
  stocks: SnapshotStock[],
  onProgress: (done: number, total: number) => void,
): Promise<SimResult[]> {
  const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const candidates = stocks
    .filter(s => Math.abs(s.changePercent) >= 2)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 25);

  const results: SimResult[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await delay(150);
    const stock = candidates[i];
    try {
      const candles = await fetchIntradayCandles(stock.symbol);
      const orb = candles.length ? computeORB(candles) : null;
      if (!orb || !candles.length) { onProgress(i + 1, candidates.length); continue; }
      const direction: "bullish" | "bearish" = stock.changePercent >= 2 ? "bullish" : "bearish";
      const events = detectAllEvents(candles, orb);
      const orbRangePct = orb.high > 0 ? (orb.high - orb.low) / orb.high : 0;
      results.push({
        symbol: stock.symbol,
        sector: stock.sector ?? getSector(stock.symbol),
        changePercent: stock.changePercent,
        ltp930: stock.ltp,
        orbHigh: orb.high,
        orbLow: orb.low,
        orbRangePct,
        direction,
        ...parseOutcome(events, candles, direction),
      });
    } catch { /* skip */ }
    onProgress(i + 1, candidates.length);
  }

  return results.sort((a, b) => {
    if (a.hadBreakout !== b.hadBreakout) return a.hadBreakout ? -1 : 1;
    return (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity);
  });
}

// ── Status label ───────────────────────────────────────────────────────────────

function statusLabel(r: SimResult): { text: string; className: string } {
  if (!r.hadBreakout) return { text: "NO BREAKOUT", className: "text-muted-foreground border-border/40" };
  if (r.exitReason === "sl_hit")   return { text: "SL HIT",    className: "text-bearish border-bearish/40" };
  if (r.exitReason === "cost_exit") return { text: "COST SAFE", className: "text-primary border-primary/40" };
  if (r.partialBooked)              return { text: "PARTIAL",   className: "text-amber-400 border-amber-400/40" };
  if (r.exitReason === "open")      return { text: "OPEN",      className: "text-primary border-primary/40" };
  if ((r.pnl ?? 0) > 0)            return { text: "PROFIT",    className: "text-bullish border-bullish/40" };
  return { text: "LOSS", className: "text-bearish border-bearish/40" };
}

// ── Expanded detail card ───────────────────────────────────────────────────────

function SimResultCard({ result }: { result: SimResult }) {
  const [chartOpen, setChartOpen] = useState(false);
  const { text: stText, className: stClass } = statusLabel(result);
  const isOpen = result.exitReason === "open";
  const pnlColor = result.pnl == null ? "text-muted-foreground/50"
    : result.pnl >= 0 ? "text-bullish" : "text-bearish";
  const dirColor = result.direction === "bullish"
    ? "border-bullish/40 text-bullish bg-bullish/8"
    : "border-bearish/40 text-bearish bg-bearish/8";

  // Build TradeChartInfo for TradeDetailChart
  const chartInfo = result.hadBreakout && result.entryPrice != null && result.slPrice != null ? {
    symbol: result.symbol,
    direction: result.direction,
    entryStockPrice: result.entryPrice,
    exitStockPrice: result.exitReason !== "open" ? result.exitPrice : null,
    entryTime: result.entryTime ? result.entryTime * 1000 : Date.now(),
    exitTime: result.exitTime && result.exitReason !== "open" ? result.exitTime * 1000 : null,
    orbHigh: result.orbHigh,
    orbLow: result.orbLow,
    slPrice: result.slPrice,
    target1: result.target1,
    target2: result.target2,
    status: isOpen ? "OPEN" : "SL_HIT",
    sector: result.sector,
  } : null;

  return (
    <div className={`rounded-lg border transition-all ${
      !result.hadBreakout
        ? "border-border/20 bg-muted/5 opacity-60"
        : result.exitReason === "sl_hit"
        ? "border-bearish/20 bg-bearish/3"
        : result.pnl != null && result.pnl > 0
        ? "border-bullish/20 bg-bullish/3"
        : "border-border/30 bg-card/40"
    }`}>
      {/* ── Header ── */}
      <div className="flex items-start gap-3 p-3">
        {/* Direction badge */}
        <span className={`shrink-0 text-xs font-bold px-1.5 py-0.5 rounded border font-mono mt-0.5 ${dirColor}`}>
          {result.direction === "bullish" ? "BUY" : "SELL"}
        </span>

        {/* Symbol + sector */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold font-mono text-foreground">{result.symbol}</span>
            <span className={`text-xs font-semibold ${result.changePercent >= 0 ? "text-bullish" : "text-bearish"}`}>
              {result.changePercent >= 0 ? "+" : ""}{result.changePercent.toFixed(2)}% @9:30
            </span>
            {isOpen && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
            <Badge variant="outline" className={`text-[10px] px-1.5 ${stClass}`}>{stText}</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground/60 mt-0.5">{result.sector}</div>
        </div>

        {/* P&L */}
        <div className={`text-right shrink-0 font-mono font-bold text-sm ${pnlColor}`}>
          {result.pnl != null
            ? `${result.pnl >= 0 ? "+" : ""}₹${result.pnl.toFixed(0)}`
            : "—"}
        </div>
      </div>

      {/* ── Detail grid (always visible) ── */}
      {result.hadBreakout ? (
        <div className="px-3 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs border-t border-border/20 pt-2">
          {/* ORB */}
          <div>
            <p className="text-muted-foreground/55 text-[10px] uppercase tracking-wide">ORB H / L</p>
            <p className="font-mono">
              <span className="text-bullish/80">{fmtPrice(result.orbHigh, 1)}</span>
              <span className="text-muted-foreground/40 mx-1">/</span>
              <span className="text-bearish/80">{fmtPrice(result.orbLow, 1)}</span>
              <span className="text-muted-foreground/50 ml-1">({(result.orbRangePct * 100).toFixed(2)}%)</span>
            </p>
          </div>

          {/* Entry */}
          <div>
            <p className="text-muted-foreground/55 text-[10px] uppercase tracking-wide flex items-center gap-1">
              <LogIn className="h-2.5 w-2.5" /> Entry
            </p>
            <p className="font-mono text-foreground">{fmtPrice(result.entryPrice)}</p>
            <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />{fmtTime(result.entryTime)}
            </p>
          </div>

          {/* SL */}
          <div>
            <p className="text-muted-foreground/55 text-[10px] uppercase tracking-wide flex items-center gap-1">
              <ShieldAlert className="h-2.5 w-2.5" /> Initial SL
            </p>
            <p className="font-mono text-warning">{fmtPrice(result.slPrice)}</p>
            <p className="text-[10px] text-muted-foreground/50">
              Risk/share ₹{result.slPrice != null && result.entryPrice != null
                ? Math.abs(result.entryPrice - result.slPrice).toFixed(1)
                : "—"}
            </p>
          </div>

          {/* Exit */}
          <div>
            <p className="text-muted-foreground/55 text-[10px] uppercase tracking-wide flex items-center gap-1">
              <LogOut className="h-2.5 w-2.5" />{isOpen ? "Last Price" : "Exit"}
            </p>
            <p className={`font-mono ${pnlColor}`}>{fmtPrice(result.exitPrice)}</p>
            <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />{fmtTime(result.exitTime)}
            </p>
          </div>

          {/* Targets row */}
          <div className="col-span-2">
            <p className="text-muted-foreground/55 text-[10px] uppercase tracking-wide flex items-center gap-1">
              <Target className="h-2.5 w-2.5" /> Targets
            </p>
            <p className="font-mono">
              <span className="text-muted-foreground/70">T1 {fmtPrice(result.target1, 1)}</span>
              <span className="text-muted-foreground/40 mx-2">·</span>
              <span className="text-muted-foreground/70">T2 {fmtPrice(result.target2, 1)}</span>
            </p>
          </div>

          {/* Partial booking */}
          {result.partialBooked && (
            <div className="col-span-2">
              <p className="text-muted-foreground/55 text-[10px] uppercase tracking-wide">50% Booked</p>
              <p className="font-mono text-amber-400">
                {fmtPrice(result.partialExitPrice)} · +₹{result.partialPnl?.toFixed(0)}
              </p>
            </div>
          )}

          {/* Capital / shares */}
          <div className="col-span-2 sm:col-span-4 pt-0.5 border-t border-border/10 mt-1">
            <p className="text-[10px] text-muted-foreground/50">
              ₹30K capital · {result.shares} shares · {result.direction === "bullish" ? "Long" : "Short"} delivery
            </p>
          </div>
        </div>
      ) : (
        <div className="px-3 pb-2 pt-1 grid grid-cols-2 gap-2 text-xs border-t border-border/10">
          <div>
            <p className="text-muted-foreground/55 text-[10px] uppercase tracking-wide">ORB H / L</p>
            <p className="font-mono">
              <span className="text-bullish/80">{fmtPrice(result.orbHigh, 1)}</span>
              <span className="text-muted-foreground/40 mx-1">/</span>
              <span className="text-bearish/80">{fmtPrice(result.orbLow, 1)}</span>
            </p>
          </div>
          <div>
            <p className="text-muted-foreground/55 text-[10px] uppercase tracking-wide">ORB Range</p>
            <p className="font-mono text-muted-foreground">{(result.orbRangePct * 100).toFixed(2)}%</p>
          </div>
        </div>
      )}

      {/* ── Chart toggle (only for breakout trades) ── */}
      {result.hadBreakout && chartInfo && (
        <div className="border-t border-border/20">
          <button
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            onClick={() => setChartOpen(v => !v)}
          >
            {chartOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {chartOpen ? "Hide Chart" : "Show Chart"}
          </button>
          {chartOpen && (
            <div className="px-3 pb-3">
              <TradeDetailChart trade={chartInfo} height={300} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Widget ────────────────────────────────────────────────────────────────

export default function TodaySimWidget() {
  const [results, setResults] = useState<SimResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const snapshot = loadTodaySnapshot();
  const snapshotTime = snapshot
    ? new Date(snapshot.capturedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
      })
    : null;

  const screened  = results?.length ?? 0;
  const breakouts = results?.filter(r => r.hadBreakout) ?? [];
  const winners   = breakouts.filter(r => (r.pnl ?? 0) > 0);
  const losers    = breakouts.filter(r => (r.pnl ?? 0) < 0);
  const totalPnL  = results?.reduce((s, r) => s + (r.pnl ?? 0), 0) ?? null;

  const handleRun = useCallback(async () => {
    const snap = loadTodaySnapshot();
    if (!snap) return;
    setRunning(true);
    setResults(null);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await runSimulation(snap.stocks, (done, total) => setProgress({ done, total }));
      setResults(res);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, []);

  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Zap className="h-4 w-4 text-primary" />
          Today's ORB Simulation
          {snapshotTime && (
            <span className="text-[10px] text-muted-foreground/50 font-normal">· snapshot {snapshotTime}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {results != null && (
              <>
                <Badge variant="outline" className="text-xs h-5 px-2 text-muted-foreground border-border/40">
                  {breakouts.length}/{screened} breakouts
                </Badge>
                <Badge variant="outline" className="text-xs h-5 px-2 text-bullish border-bullish/40">
                  W {winners.length}
                </Badge>
                <Badge variant="outline" className="text-xs h-5 px-2 text-bearish border-bearish/40">
                  L {losers.length}
                </Badge>
                {totalPnL != null && (
                  <Badge
                    variant="outline"
                    className={`text-xs h-5 px-2 font-mono font-bold ${
                      totalPnL >= 0 ? "text-bullish border-bullish/40" : "text-bearish border-bearish/40"
                    }`}
                  >
                    {totalPnL >= 0 ? "+" : ""}₹{totalPnL.toFixed(0)}
                  </Badge>
                )}
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs gap-1.5 px-3"
              onClick={handleRun}
              disabled={running || !snapshot}
              title={!snapshot ? "No 9:30 AM snapshot — take one from the watchlist panel first" : undefined}
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
              {results ? "Re-run" : "Run Simulation"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="px-3 pb-3">
        {/* Progress */}
        {running && progress && (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Simulating {progress.done} / {progress.total} stocks...
          </div>
        )}

        {/* Empty / no snapshot */}
        {!running && results == null && (
          <div className="py-10 text-center">
            <Zap className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {snapshot
                ? "Click Run Simulation to screen today's ORB setups"
                : "No 9:30 AM snapshot — take one from the watchlist panel first"}
            </p>
            {snapshot && (
              <p className="text-xs text-muted-foreground/50 mt-1">
                {snapshot.stocks.filter(s => Math.abs(s.changePercent) >= 2).length} stocks ≥±2% in snapshot
              </p>
            )}
          </div>
        )}

        {/* No results */}
        {!running && results != null && results.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No stocks moved ≥2% in the snapshot.
          </div>
        )}

        {/* Results */}
        {!running && results != null && results.length > 0 && (
          <ScrollArea className="h-[540px] pr-1">
            <div className="space-y-2">
              {results.map(r => <SimResultCard key={r.symbol} result={r} />)}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
