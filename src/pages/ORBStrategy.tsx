import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { createChart, createSeriesMarkers, ColorType, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type Time, type ISeriesApi, type CandlestickSeriesOptions } from "lightweight-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, Minus, Zap, Target, ShieldAlert, BookOpen,
  RefreshCw, Trash2, CheckCircle2, XCircle, Clock, BarChart2, Activity,
  ChevronRight, AlertTriangle, ArrowUpRight, ArrowDownRight, Loader2,
  CircleDot, Layers, History, RotateCcw,
} from "lucide-react";
import { useIsDark, getChartColors } from "@/hooks/useIsDark";
import {
  useORBStrategy, useIntradayCandles, computeORB, computeEMA, detectSignal, detectAllEvents,
  computePaperTradePnL, sharesFor20K, getATMStrike, getLotSize, SECTOR_STOCKS,
  type ORBCandle, type ORBRange, type ORBSignal, type PaperTrade, type StockData,
  type AdvanceDecline,
} from "@/hooks/useORBStrategy";
import { TradeDetailChart } from "@/components/TradeDetailChart";
import TodaySimWidget from "@/components/TodaySimWidget";

// ── ORB Chart ──────────────────────────────────────────────────────────────
interface ORBChartProps { symbol: string; height?: number; }

function ORBChart({ symbol, height = 340 }: ORBChartProps) {
  const chartRef = useRef<IChartApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark();
  const { data: candles = [], isLoading } = useIntradayCandles(symbol);

  const orb = useMemo(() => candles.length ? computeORB(candles) : null, [candles]);
  const signal = useMemo(() => orb && candles.length ? detectSignal(candles, orb) : null, [candles, orb]);
  const allEvents = useMemo(() => orb && candles.length ? detectAllEvents(candles, orb) : [], [candles, orb]);
  const emas9 = useMemo(() => candles.length ? computeEMA(candles, 9) : [], [candles]);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const colors = getChartColors(isDark);
    const grid = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.text,
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 11,
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: {
        vertLine: { color: "rgba(255,255,255,0.15)", width: 1, style: 2, labelBackgroundColor: colors.primary },
        horzLine: { color: "rgba(255,255,255,0.15)", width: 1, style: 2, labelBackgroundColor: colors.primary },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 5 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });
    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: colors.bullish,
      downColor: colors.bearish,
      borderUpColor: colors.bullish,
      borderDownColor: colors.bearish,
      wickUpColor: colors.bullish,
      wickDownColor: colors.bearish,
    });
    candleSeries.setData(candles.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));

    // ORB high / low price lines
    if (orb) {
      (candleSeries as any).createPriceLine({
        price: orb.high,
        color: "rgba(52, 211, 153, 0.85)",
        lineWidth: 2,
        lineStyle: 1, // dashed
        axisLabelVisible: true,
        title: "ORB H",
      });
      (candleSeries as any).createPriceLine({
        price: orb.low,
        color: "rgba(248, 113, 113, 0.85)",
        lineWidth: 2,
        lineStyle: 1,
        axisLabelVisible: true,
        title: "ORB L",
      });
      (candleSeries as any).createPriceLine({
        price: orb.midpoint,
        color: "rgba(148, 163, 184, 0.4)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: "MID",
      });
    }

    // Draw T1 / T3 / Entry price lines from the first entry event
    const firstEntry = allEvents.find(e => e.kind === "entry" || e.kind === "reentry");
    if (firstEntry?.entryMeta && orb) {
      const { target1: t1, target2: t2 } = firstEntry.entryMeta;
      const isBull = firstEntry.signal.type === "bullish";
      // Entry level (same as ORB H/L but labelled Entry for clarity on re-entries)
      const entryLevel = isBull ? orb.high : orb.low;
      (candleSeries as any).createPriceLine({
        price: entryLevel,
        color: "rgba(167, 139, 250, 0.9)",
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Entry",
      });
      // T1 — 1:1 reward level (green dashed)
      (candleSeries as any).createPriceLine({
        price: t1,
        color: "rgba(34, 197, 94, 0.8)",
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `T1 ${t1.toFixed(2)}`,
      });
      // T2 — 2R reward level (purple dashed)
      (candleSeries as any).createPriceLine({
        price: t2,
        color: "rgba(168, 85, 247, 0.8)",
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `T2 ${t2.toFixed(2)}`,
      });
    }

    // All event markers: entries, SL hits, re-entries (v5 API: createSeriesMarkers)
    if (allEvents.length > 0) {
      createSeriesMarkers(
        candleSeries,
        allEvents.map(ev => {
          const isBull = ev.signal.type === "bullish";
          if (ev.kind === "sl_hit") {
            return {
              time: ev.signal.candle.time as Time,
              position: isBull ? "aboveBar" : "belowBar" as const,
              color: "#ef4444",
              shape: "circle" as const,
              text: "SL ✕",
              size: 1,
            };
          }
          if (ev.kind === "target_1x") {
            return {
              time: ev.signal.candle.time as Time,
              position: isBull ? "aboveBar" : "belowBar" as const,
              color: "#22c55e",
              shape: "circle" as const,
              text: "T1",
              size: 1,
            };
          }
          if (ev.kind === "target_2x") {
            return {
              time: ev.signal.candle.time as Time,
              position: isBull ? "aboveBar" : "belowBar" as const,
              color: "#a855f7",
              shape: "circle" as const,
              text: "T2",
              size: 1,
            };
          }
          // entry / reentry
          return {
            time: ev.signal.candle.time as Time,
            position: isBull ? "belowBar" : "aboveBar" as const,
            color: isBull ? colors.bullish : colors.bearish,
            shape: (isBull ? "arrowUp" : "arrowDown") as const,
            text: ev.kind === "reentry"
              ? (isBull ? `RE ▲` : `RE ▼`)
              : (isBull ? "BO ▲" : "BO ▼"),
            size: ev.kind === "reentry" ? 1 : 2,
          };
        })
      );
    }

    // EMA 9 line
    if (emas9.length === candles.length) {
      const ema9Series = chart.addSeries(LineSeries, {
        color: "rgba(251, 191, 36, 0.85)", // amber
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: "EMA9",
      });
      ema9Series.setData(
        candles
          .map((c, i) => ({ time: c.time as Time, value: emas9[i] }))
          .filter(d => d.value > 0)
      );
    }

    // Volume
    const volData = candles.filter(c => c.volume > 0).map((c, i, arr) => ({
      time: c.time as Time,
      value: c.volume,
      color: i > 0 && c.close >= arr[i - 1].close
        ? `hsl(${colors.bullishRaw} / 0.2)`
        : `hsl(${colors.bearishRaw} / 0.18)`,
    }));
    if (volData.length > 0) {
      const volSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
      volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volSeries.setData(volData);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(entries => {
      chart.applyOptions({ width: entries[0].contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, orb, signal, emas9, isDark, height]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading intraday data...
        </div>
      </div>
    );
  }

  if (candles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2" style={{ height }}>
        <BarChart2 className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No intraday data — market may be closed or pre-open</p>
        <p className="text-xs text-muted-foreground/60">ORB data loads after 9:15 AM IST on trading days</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Chart meta strip */}
      <div className="flex flex-wrap items-center gap-3 text-xs px-1">
        {orb ? (
          <>
            <span className="text-muted-foreground">ORB</span>
            <span className="font-mono text-bullish">H:{orb.high.toFixed(2)}</span>
            <span className="font-mono text-bearish">L:{orb.low.toFixed(2)}</span>
            <span className="font-mono text-muted-foreground/60">W:{(orb.high - orb.low).toFixed(2)}</span>
          </>
        ) : (
          <span className="text-muted-foreground/60">ORB range will appear after 9:30 AM IST</span>
        )}
        {/* EMA 9 current value */}
        {emas9.length > 0 && (
          <span className="flex items-center gap-1 text-warning/80">
            <span className="inline-block h-2 w-2 rounded-full bg-warning/70" />
            EMA9: {emas9[emas9.length - 1].toFixed(2)}
          </span>
        )}
        {signal && (
          <Badge
            variant="outline"
            className={`ml-auto text-xs gap-1 ${signal.type === "bullish" ? "border-bullish/40 text-bullish" : "border-bearish/40 text-bearish"}`}
          >
            {signal.type === "bullish" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            BO @ {signal.candle.close.toFixed(2)}
            {signal.momentum && (
              <span className="ml-0.5 opacity-70">{signal.momentum.slopeDeg.toFixed(0)}°</span>
            )}
          </Badge>
        )}
      </div>
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
    </div>
  );
}

// ── Bias Pill ──────────────────────────────────────────────────────────────
function BiasPill({ bias }: { bias: "bullish" | "bearish" | "neutral" }) {
  if (bias === "bullish") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-bullish/15 text-bullish border border-bullish/30">
      <TrendingUp className="h-3 w-3" /> BULLISH
    </span>
  );
  if (bias === "bearish") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-bearish/15 text-bearish border border-bearish/30">
      <TrendingDown className="h-3 w-3" /> BEARISH
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-muted/40 text-muted-foreground border border-border/40">
      <Minus className="h-3 w-3" /> NEUTRAL
    </span>
  );
}

// ── Stock Signal Row ──────────────────────────────────────────────────────
interface StockSignalRowProps {
  stock: StockData;
  isSelected: boolean;
  onSelect: () => void;
  onTrade: (signal: ORBSignal, orb: ORBRange, reentryCount?: number) => void;
  niftyBias: "bullish" | "bearish" | "neutral";
  paperTrades: PaperTrade[];
  onAutoTrade: (signal: ORBSignal, orb: ORBRange, reentryCount: number) => void;
  onAutoExit: (id: string, exitPrice: number) => void;
  onUpdateTrade: (id: string, updates: Partial<PaperTrade>) => void;
}

function StockSignalRow({ stock, isSelected, onSelect, onTrade, niftyBias, paperTrades, onAutoTrade, onAutoExit, onUpdateTrade }: StockSignalRowProps) {
  const { data: candles = [] } = useIntradayCandles(stock.symbol);
  const orb = useMemo(() => candles.length ? computeORB(candles) : null, [candles]);
  const allEvents = useMemo(() => orb && candles.length ? detectAllEvents(candles, orb) : [], [candles, orb]);

  // The actionable event is the latest entry/reentry with no subsequent SL hit
  const activeEvent = useMemo(() => {
    let candidate = null;
    for (const ev of allEvents) {
      if (ev.kind === "entry" || ev.kind === "reentry") candidate = ev;
      if (ev.kind === "sl_hit") candidate = null; // SL wipes the current entry
    }
    return candidate;
  }, [allEvents]);

  const lastEvent = allEvents[allEvents.length - 1] ?? null;
  const slHitCount = allEvents.filter(e => e.kind === "sl_hit").length;
  const reentryCount = allEvents.filter(e => e.kind === "reentry").length;

  const up = stock.changePercent >= 0;
  const stockDir = up ? "bullish" : "bearish";

  // Gate rules:
  // • Bullish NIFTY → only CE/bullish breakouts, regardless of anything else
  // • Bearish NIFTY → only PE/bearish breakdowns, regardless of anything else
  // • Neutral NIFTY → signal must match the stock's own direction
  const hasValidSignal = !!activeEvent && (
    niftyBias === "bullish" ? activeEvent.signal.type === "bullish" :
    niftyBias === "bearish" ? activeEvent.signal.type === "bearish" :
    activeEvent.signal.type === stockDir
  );

  // Auto-log eligible trades once per signal (deduplicated via orbHigh + direction + time)
  const autoLoggedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // hasValidSignal already encodes the niftyBias gate — only fires when signal is valid for current market
    if (!activeEvent || !orb || !hasValidSignal) return;
    const signal = activeEvent.signal;
    // Only first occurrence of this breakout candle time per symbol (prevents re-fires on every candle update)
    const key = `${stock.symbol}-${orb.high.toFixed(0)}-${signal.time}-${signal.type}`;
    if (autoLoggedRef.current.has(key)) return;
    const alreadyExists = paperTrades.some(t =>
      t.symbol === stock.symbol &&
      t.orbHigh === orb.high &&
      t.direction === signal.type
    );
    autoLoggedRef.current.add(key);
    if (!alreadyExists) {
      onAutoTrade(signal, orb, activeEvent.reentryCount + (activeEvent.kind === "reentry" ? 1 : 0));
    }
  }, [activeEvent?.signal.time, orb?.high, hasValidSignal, stock.symbol]);

  // Auto-exit when SL hit
  const autoExitedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!orb) return;
    const lastEv = allEvents[allEvents.length - 1];
    if (!lastEv || lastEv.kind !== "sl_hit") return;
    const slTime = lastEv.signal.time * 1000;
    const openForStock = paperTrades.filter(t =>
      t.symbol === stock.symbol && t.status === "OPEN" && t.orbHigh === orb.high && t.entryTime < slTime
    );
    for (const trade of openForStock) {
      const key = `${trade.id}-${lastEv.signal.time}`;
      if (autoExitedRef.current.has(key)) continue;
      autoExitedRef.current.add(key);
      onAutoExit(trade.id, lastEv.signal.candle.close);
    }
  }, [allEvents, orb, paperTrades, stock.symbol, onAutoExit]);

  // Auto-move SL to entry when 1:1 hit
  const auto1xRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!orb) return;
    const ev1x = allEvents.find(e => e.kind === "target_1x");
    if (!ev1x) return;
    const openForStock = paperTrades.filter(t =>
      t.symbol === stock.symbol && t.status === "OPEN" && t.orbHigh === orb.high && !t.slMovedToCost
    );
    for (const trade of openForStock) {
      const key = `${trade.id}-1x-${ev1x.signal.time}`;
      if (auto1xRef.current.has(key)) continue;
      auto1xRef.current.add(key);
      onUpdateTrade(trade.id, { slMovedToCost: true, slPrice: trade.entryStockPrice });
    }
  }, [allEvents, orb, paperTrades, stock.symbol, onUpdateTrade]);

  // Auto-book 50% at 2R
  const auto3xRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!orb) return;
    const ev3x = allEvents.find(e => e.kind === "target_2x");
    if (!ev3x) return;
    const openForStock = paperTrades.filter(t =>
      t.symbol === stock.symbol && t.status === "OPEN" && t.orbHigh === orb.high && !t.partialBooked
    );
    for (const trade of openForStock) {
      const key = `${trade.id}-2x-${ev3x.signal.time}`;
      if (auto3xRef.current.has(key)) continue;
      auto3xRef.current.add(key);
      onUpdateTrade(trade.id, {
        partialBooked: true,
        partialExitPrice: ev3x.signal.breakoutPrice,
        partialExitTime: ev3x.signal.time * 1000,
        slMovedToCost: true,
        slPrice: trade.entryStockPrice,
      });
    }
  }, [allEvents, orb, paperTrades, stock.symbol, onUpdateTrade]);

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 border ${
        isSelected
          ? "border-primary/40 bg-primary/5 shadow-sm"
          : "border-transparent hover:border-border/40 hover:bg-accent/20"
      }`}
    >
      {/* Symbol + sector */}
      <div className="w-28 shrink-0">
        <p className="text-xs font-bold text-foreground font-mono">{stock.symbol}</p>
        <div className="flex items-center gap-1">
          <p className="text-xs text-muted-foreground/70 truncate">{stock.sector}</p>
          {slHitCount > 0 && (
            <span className="text-xs text-warning/70 font-mono shrink-0">SL×{slHitCount}</span>
          )}
          {reentryCount > 0 && (
            <span className="text-xs text-primary/70 font-mono shrink-0">RE×{reentryCount}</span>
          )}
        </div>
      </div>

      {/* LTP + change */}
      <div className="w-24 shrink-0 text-right">
        <p className="text-xs font-mono font-semibold text-foreground">
          {stock.ltp > 0 ? `₹${stock.ltp.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
        </p>
        <p className={`text-xs font-mono font-medium ${up ? "text-bullish" : "text-bearish"}`}>
          {up ? "+" : ""}{stock.changePercent.toFixed(2)}%
        </p>
      </div>

      {/* ORB range + SL */}
      <div className="flex-1 min-w-0">
        {orb ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-bullish/80">H:{orb.high.toFixed(0)}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-bearish/80">L:{orb.low.toFixed(0)}</span>
            </div>
            {activeEvent && (
              <div className="text-xs font-mono text-warning/70">
                SL:{(activeEvent.signal.type === "bullish" ? orb.low : orb.high).toFixed(0)}
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/40">ORB pending</span>
        )}
      </div>

      {/* Signal + action */}
      <div className="flex items-center gap-2 shrink-0">
        {hasValidSignal ? (
          <div className="flex flex-col items-end gap-0.5">
            <Button
              size="sm"
              variant="outline"
              className={`h-6 text-xs gap-1 px-2 ${
                activeEvent!.signal.type === "bullish"
                  ? "border-bullish/40 text-bullish hover:bg-bullish/10"
                  : "border-bearish/40 text-bearish hover:bg-bearish/10"
              } ${activeEvent!.kind === "reentry" ? "ring-1 ring-primary/40" : ""}`}
              onClick={e => {
                e.stopPropagation();
                onTrade(activeEvent!.signal, orb!, activeEvent!.reentryCount + (activeEvent!.kind === "reentry" ? 1 : 0));
              }}
            >
              {activeEvent!.signal.type === "bullish" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {activeEvent!.kind === "reentry" ? "RE" : activeEvent!.signal.type === "bullish" ? "CE ▲" : "PE ▼"}
            </Button>
            {/* Momentum slope badge */}
            {activeEvent!.signal.momentum && (
              <span className="text-xs font-mono text-warning/70">
                {activeEvent!.signal.momentum.slopeDeg.toFixed(0)}°
              </span>
            )}
          </div>
        ) : lastEvent?.kind === "sl_hit" ? (
          <Badge variant="outline" className="text-xs px-1.5 text-warning border-warning/30 gap-1">
            <XCircle className="h-2.5 w-2.5" /> SL
          </Badge>
        ) : lastEvent ? (
          <Badge variant="outline" className="text-xs px-1.5 text-muted-foreground border-border/30">
            {lastEvent.signal.type === "bullish" ? "↑" : "↓"} Active
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground/30 w-14 text-center">—</span>
        )}
        <ChevronRight className={`h-3.5 w-3.5 transition-colors ${isSelected ? "text-primary" : "text-muted-foreground/30"}`} />
      </div>
    </div>
  );
}

// ── Trade Mode ────────────────────────────────────────────────────────────
type TradeMode = "delivery" | "options";

// ── Paper Trade Row ────────────────────────────────────────────────────────
function PaperTradeRow({
  trade,
  onExit,
  onViewChart,
}: {
  trade: PaperTrade;
  onExit: (id: string, price: number) => void;
  tradeMode: TradeMode;
  onViewChart?: (trade: PaperTrade) => void;
}) {
  const { data: candles = [] } = useIntradayCandles(trade.symbol, trade.status === "OPEN");
  const liveSpot = trade.status === "OPEN" && candles.length > 0
    ? candles[candles.length - 1].close
    : (trade.exitStockPrice ?? trade.currentStockPrice);

  const isOpen = trade.status === "OPEN";
  const shares = trade.shares ?? sharesFor20K(trade.entryStockPrice);
  const pnl = computePaperTradePnL({ ...trade, currentStockPrice: liveSpot });
  const statusColor = isOpen ? "text-primary" : pnl >= 0 ? "text-bullish" : "text-bearish";

  const slLabel = trade.slMovedToCost
    ? <span className="text-xs text-primary/70 font-normal">Cost ✓</span>
    : trade.initialSL && trade.initialSL !== trade.slPrice
    ? <span className="text-xs text-warning/60 font-normal">Initial</span>
    : null;

  const dirColor = trade.direction === "bullish" ? "border-bullish/40 text-bullish bg-bullish/8" : "border-bearish/40 text-bearish bg-bearish/8";

  return (
    <div className={`rounded-lg border p-3 transition-all ${
      isOpen ? "border-primary/20 bg-primary/3" : "border-border/30 bg-muted/10"
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`shrink-0 text-xs font-bold px-1.5 py-0.5 rounded border font-mono ${dirColor}`}>
            {trade.direction === "bullish" ? "BUY" : "SELL"}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold font-mono text-foreground flex items-center gap-1.5 flex-wrap">
              {trade.symbol}
              <span className="text-muted-foreground/50 font-normal">·</span>
              <span className="text-muted-foreground/70 font-normal">{shares} shares</span>
              {trade.reentryCount > 0 && (
                <span className="text-xs font-normal text-primary/70 border border-primary/30 rounded px-1">RE#{trade.reentryCount}</span>
              )}
              {trade.partialBooked && (
                <span className="text-xs font-normal text-amber-400/80 border border-amber-400/30 rounded px-1">50% booked</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground/70 truncate">{trade.sector} · ₹30K capital</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isOpen && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
          <span className={`text-xs font-semibold ${statusColor}`}>{trade.status}</span>
        </div>
      </div>

      {/* Details grid */}
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground/60">Entry</p>
          <p className="font-mono font-medium">₹{trade.entryStockPrice.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-muted-foreground/60 flex items-center gap-1">
            {isOpen ? "Live" : "Exit"}
            {isOpen && <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block animate-pulse" />}
          </p>
          <p className="font-mono font-medium">₹{liveSpot.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-muted-foreground/60 flex items-center gap-1.5">
            <ShieldAlert className="h-3 w-3 text-warning/70" /> SL {slLabel}
          </p>
          <p className="font-mono font-medium text-warning">₹{trade.slPrice.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-muted-foreground/60">Targets</p>
          <p className="font-mono text-muted-foreground text-[10px]">
            {trade.target1 ? `1R ₹${trade.target1.toFixed(0)}` : "—"}
            {trade.target2 ? ` · 2R ₹${trade.target2.toFixed(0)}` : ""}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground/60">P&L</p>
          <p className={`font-mono font-bold ${pnl >= 0 ? "text-bullish" : "text-bearish"}`}>
            {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(0)}
          </p>
        </div>
      </div>

      {/* Partial booking strip */}
      {trade.partialBooked && trade.partialExitPrice != null && (
        <div className="mt-1.5 text-[10px] text-amber-400/70 font-mono">
          50% exited @ T2 ₹{trade.partialExitPrice.toFixed(2)} · remaining trailing EMA9
        </div>
      )}

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground/50">
        <span>{new Date(trade.entryTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
        <span className="font-mono">ORB {trade.orbHigh.toFixed(0)} / {trade.orbLow.toFixed(0)}</span>
        <div className="flex items-center gap-1">
          {onViewChart && (
            <Button size="sm" variant="ghost" className="h-5 text-xs text-muted-foreground hover:text-primary px-1.5"
              onClick={() => onViewChart(trade)} title="View trade chart">
              <BarChart2 className="h-3 w-3" />
            </Button>
          )}
          {isOpen && (
            <Button size="sm" variant="ghost" className="h-5 text-xs text-muted-foreground hover:text-bearish px-1.5"
              onClick={() => onExit(trade.id, liveSpot)}>
              Exit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 30-Day F&O ORB Strategy Backtest ────────────────────────────────────────
const PROXY_BASE_URL = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

// Build unique symbol list and reverse lookup from SECTOR_STOCKS
const ALL_FNO_SYMBOLS: string[] = [...new Set(Object.values(SECTOR_STOCKS).flat())];
const SYMBOL_TO_SECTOR = Object.entries(SECTOR_STOCKS).reduce((acc, [sec, syms]) => {
  for (const s of syms) if (!acc[s]) acc[s] = sec;
  return acc;
}, {} as Record<string, string>);

interface BacktestTrade {
  date: string;
  direction: "bullish" | "bearish";
  orbHigh: number;
  orbLow: number;
  entryPrice: number;
  slPrice: number;
  exitPrice: number;
  slHit: boolean;
  pnlPoints: number;
  pnlRs: number; // delivery-based: ₹20K capital
  shares: number;
}

async function fetchORBBacktestForSymbol(symbol: string): Promise<BacktestTrade[]> {
  try {
    const toDate = new Date();
    const fromDate = new Date(toDate);
    fromDate.setDate(fromDate.getDate() - 50);
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const params = new URLSearchParams({ symbol, interval: "D", fromDate: fmt(fromDate), toDate: fmt(toDate) });
    const res = await fetch(`${PROXY_BASE_URL}/api/yahoo-chart?${params}`);
    if (!res.ok) return [];
    const raw = await res.json();
    const timestamps: number[] = raw?.data?.timestamp || raw?.timestamp || [];
    const opens: number[] = raw?.data?.open || raw?.open || [];
    const highs: number[] = raw?.data?.high || raw?.high || [];
    const lows: number[] = raw?.data?.low || raw?.low || [];
    const closes: number[] = raw?.data?.close || raw?.close || [];

    const trades: BacktestTrade[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
      if (!o || !c || !h || !l) continue;
      const orbHigh = o * 1.003;
      const orbLow = o * 0.997;
      const isBullDay = c > o && c > orbHigh;
      const isBearDay = c < o && c < orbLow;
      if (!isBullDay && !isBearDay) continue;
      const direction: "bullish" | "bearish" = isBullDay ? "bullish" : "bearish";
      // Delivery-based: ₹20K capital per trade, shares at entry
      const shares = Math.max(1, Math.floor(20_000 / (direction === "bullish" ? orbHigh : orbLow)));
      let entryPrice: number, slPrice: number, exitPrice: number, slHit: boolean, pnlPoints: number;
      if (direction === "bullish") {
        entryPrice = orbHigh; slPrice = orbLow;
        slHit = l < orbLow;
        exitPrice = slHit ? orbLow : c;
        pnlPoints = slHit ? (orbLow - orbHigh) : (c - orbHigh);
      } else {
        entryPrice = orbLow; slPrice = orbHigh;
        slHit = h > orbHigh;
        exitPrice = slHit ? orbHigh : c;
        pnlPoints = slHit ? (orbLow - orbHigh) : (orbLow - c);
      }
      const pnlRs = pnlPoints * shares;
      const date = new Date(timestamps[i] * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      trades.push({ date, direction, orbHigh, orbLow, entryPrice, slPrice, exitPrice, slHit, pnlPoints, pnlRs, shares });
    }
    return trades.slice(-30);
  } catch {
    return [];
  }
}

interface FnOStockBacktest {
  symbol: string;
  sector: string;
  trades: BacktestTrade[];
  wins: number;
  losses: number;
  netPnL: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
}

function useAllFnOBacktest(enabled: boolean) {
  return useQuery({
    queryKey: ["all-fno-backtest-30d"],
    queryFn: async (): Promise<FnOStockBacktest[]> => {
      // Batch in groups of 15; 150ms pause between batches to avoid Yahoo rate limits
      const BATCH = 15;
      const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
      const allResults: FnOStockBacktest[] = [];
      for (let i = 0; i < ALL_FNO_SYMBOLS.length; i += BATCH) {
        const batch = ALL_FNO_SYMBOLS.slice(i, i + BATCH);
        if (i > 0) await delay(150);
        const batchRes = await Promise.all(batch.map(async sym => {
          const trades = await fetchORBBacktestForSymbol(sym);
          if (trades.length === 0) return null;
          const wins = trades.filter(t => t.pnlRs > 0);
          const losses = trades.filter(t => t.pnlRs <= 0);
          const netPnL = trades.reduce((s, t) => s + t.pnlRs, 0);
          return {
            symbol: sym,
            sector: SYMBOL_TO_SECTOR[sym] ?? "Other",
            trades,
            wins: wins.length,
            losses: losses.length,
            netPnL,
            winRate: Math.round((wins.length / trades.length) * 100),
            avgWin: wins.length > 0 ? wins.reduce((s, t) => s + t.pnlRs, 0) / wins.length : 0,
            avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + t.pnlRs, 0) / losses.length : 0,
            bestTrade: Math.max(...trades.map(t => t.pnlRs)),
            worstTrade: Math.min(...trades.map(t => t.pnlRs)),
          };
        }));
        allResults.push(...(batchRes.filter(Boolean) as FnOStockBacktest[]));
      }
      return allResults.sort((a, b) => b.netPnL - a.netPnL);
    },
    staleTime: 30 * 60 * 1000,
    enabled,
  });
}

function AllFnOBacktest({ highlightSymbol }: { highlightSymbol: string }) {
  const [show, setShow] = useState(false);
  const [expandedSym, setExpandedSym] = useState<string | null>(null);
  const { data: stocks = [], isLoading, isFetching } = useAllFnOBacktest(show);

  const totalSignals = stocks.reduce((s, x) => s + x.trades.length, 0);
  const totalWins = stocks.reduce((s, x) => s + x.wins, 0);
  const overallWinRate = totalSignals > 0 ? Math.round((totalWins / totalSignals) * 100) : 0;
  const totalNetPnL = stocks.reduce((s, x) => s + x.netPnL, 0);

  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          30-Day ORB Backtest — All F&O Stocks (Delivery ₹20K/trade)
          {!show ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-6 text-xs gap-1 px-3"
              onClick={() => setShow(true)}
            >
              <Loader2 className={`h-3 w-3 ${isLoading ? "animate-spin" : "hidden"}`} />
              Run Backtest ({ALL_FNO_SYMBOLS.length} stocks)
            </Button>
          ) : (
            <>
              {!isLoading && stocks.length > 0 && (
                <div className="ml-auto flex items-center gap-3 text-xs font-normal">
                  <span className="text-muted-foreground">{stocks.length} stocks · {totalSignals} signals</span>
                  <span className={`font-mono font-bold ${overallWinRate >= 50 ? "text-bullish" : "text-bearish"}`}>
                    {overallWinRate}% win rate
                  </span>
                  <span className={`font-mono font-bold ${totalNetPnL >= 0 ? "text-bullish" : "text-bearish"}`}>
                    Net: {totalNetPnL >= 0 ? "+" : ""}₹{(totalNetPnL / 1000).toFixed(1)}K
                  </span>
                </div>
              )}
              {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />}
            </>
          )}
        </CardTitle>
      </CardHeader>

      {show && (
        <CardContent className="px-3 pb-3">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground text-sm">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p>Fetching daily data for {ALL_FNO_SYMBOLS.length} F&O stocks...</p>
              <p className="text-xs text-muted-foreground/60">This may take 10–20 seconds · Results cached for 30 min</p>
            </div>
          ) : stocks.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No data available</p>
          ) : (
            <>
              <div className="overflow-auto max-h-[360px]">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 bg-card/95 backdrop-blur-sm z-10">
                    <tr className="text-muted-foreground/70 border-b border-border/50">
                      <th className="text-left py-1.5 px-2 font-medium">Symbol</th>
                      <th className="text-left py-1.5 px-2 font-medium">Sector</th>
                      <th className="text-right py-1.5 px-2 font-medium">Trades</th>
                      <th className="text-right py-1.5 px-2 font-medium">Win%</th>
                      <th className="text-right py-1.5 px-2 font-medium">Best</th>
                      <th className="text-right py-1.5 px-2 font-medium">Worst</th>
                      <th className="text-right py-1.5 px-2 font-medium">Net P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stocks.map((s) => (
                      <>
                        <tr
                          key={s.symbol}
                          onClick={() => setExpandedSym(expandedSym === s.symbol ? null : s.symbol)}
                          className={`border-b border-border/20 cursor-pointer hover:bg-muted/20 transition-colors ${
                            s.symbol === highlightSymbol ? "bg-primary/5 ring-1 ring-inset ring-primary/20" :
                            s.netPnL > 0 ? "bg-bullish/3" : "bg-bearish/3"
                          }`}
                        >
                          <td className="py-1 px-2 font-semibold text-foreground">
                            <span className="flex items-center gap-1">
                              {s.symbol === highlightSymbol && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                              {s.symbol}
                            </span>
                          </td>
                          <td className="py-1 px-2 text-muted-foreground/70">{s.sector}</td>
                          <td className="py-1 px-2 text-right">{s.trades.length}</td>
                          <td className={`py-1 px-2 text-right font-bold ${s.winRate >= 50 ? "text-bullish" : "text-bearish"}`}>
                            {s.winRate}%
                          </td>
                          <td className="py-1 px-2 text-right text-bullish">+₹{s.bestTrade.toFixed(0)}</td>
                          <td className="py-1 px-2 text-right text-bearish">₹{s.worstTrade.toFixed(0)}</td>
                          <td className={`py-1 px-2 text-right font-bold ${s.netPnL >= 0 ? "text-bullish" : "text-bearish"}`}>
                            {s.netPnL >= 0 ? "+" : ""}₹{s.netPnL.toFixed(0)}
                          </td>
                        </tr>
                        {expandedSym === s.symbol && s.trades.slice(-10).reverse().map((t, ti) => (
                          <tr key={`${s.symbol}-${ti}`} className="border-b border-border/10 bg-accent/10">
                            <td className="py-0.5 pl-6 pr-2 text-muted-foreground">{t.date}</td>
                            <td className="py-0.5 px-2 text-center">
                              {t.direction === "bullish"
                                ? <span className="text-bullish text-[10px]">CE ▲</span>
                                : <span className="text-bearish text-[10px]">PE ▼</span>
                              }
                            </td>
                            <td className="py-0.5 px-2 text-right text-[10px]">{t.entryPrice.toFixed(1)}</td>
                            <td className="py-0.5 px-2 text-right text-warning/80 text-[10px]">{t.slPrice.toFixed(1)}</td>
                            <td className="py-0.5 px-2 text-right text-[10px]">{t.exitPrice.toFixed(1)}</td>
                            <td className="py-0.5 px-2 text-center text-[10px]">
                              {t.slHit
                                ? <span className="text-bearish">SL</span>
                                : <span className="text-bullish">WIN</span>
                              }
                            </td>
                            <td className={`py-0.5 px-2 text-right text-[10px] font-bold ${t.pnlRs >= 0 ? "text-bullish" : "text-bearish"}`}>
                              {t.pnlRs >= 0 ? "+" : ""}₹{t.pnlRs.toFixed(0)}
                            </td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-2 px-1">
                ORB ≈ open ±0.3% · Delivery-based · ₹20K per trade · SL = opposite ORB level · Click row to expand last 10 days
              </p>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Sector Pill Grid ───────────────────────────────────────────────────────
function SectorPills({ sectors }: { sectors: { name: string; avgChange: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {sectors.map(sec => {
        const up = sec.avgChange >= 0;
        return (
          <span
            key={sec.name}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
              up ? "bg-bullish/8 text-bullish border-bullish/25" : "bg-bearish/8 text-bearish border-bearish/25"
            }`}
          >
            {up ? "▲" : "▼"} {sec.name}
            <span className="font-mono">{up ? "+" : ""}{sec.avgChange.toFixed(2)}%</span>
          </span>
        );
      })}
    </div>
  );
}

// ── A/D Indicator ──────────────────────────────────────────────────────────
function ADIndicator({ ad }: { ad: AdvanceDecline }) {
  const pct = ad.total > 0 ? (ad.advancing / ad.total) * 100 : 50;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground/70 shrink-0">A/D</span>
      <div className="flex items-center gap-1">
        <span className="font-mono font-bold text-bullish">{ad.advancing}↑</span>
        <span className="text-muted-foreground/40">/</span>
        <span className="font-mono font-bold text-bearish">{ad.declining}↓</span>
      </div>
      {/* breadth bar */}
      <div className="w-16 h-1.5 rounded-full bg-bearish/25 overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full transition-all ${ad.breadth === "bullish" ? "bg-bullish" : ad.breadth === "bearish" ? "bg-bearish" : "bg-warning"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`font-mono shrink-0 ${ad.breadth === "bullish" ? "text-bullish" : ad.breadth === "bearish" ? "text-bearish" : "text-warning"}`}>
        {ad.ratio >= 99 ? "∞" : ad.ratio.toFixed(1)}x
      </span>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function ORBStrategy() {
  const {
    niftyBias, orbBias, advanceDecline, vix, sectorStrengths, activeSectors, watchlist, isLoadingData,
    snapshotTime, hasSnapshot, isActiveOverridden,
    takeSnapshot, restoreBaseSnapshot,
    selectedSymbol, setSelectedSymbol,
    paperTrades, addPaperTrade, exitTrade, updateTrade, clearTrades,
  } = useORBStrategy();

  const [tradeMode, setTradeMode] = useState<TradeMode>("delivery");
  const [selectedTradeForChart, setSelectedTradeForChart] = useState<PaperTrade | null>(null);

  const openTrades = paperTrades.filter(t => t.status === "OPEN");
  const closedTrades = paperTrades.filter(t => t.status !== "OPEN");
  const todayTradeCount = paperTrades.filter(t => {
    const d = new Date(t.entryTime);
    return d.toDateString() === new Date().toDateString();
  }).length;

  const totalPnL = paperTrades.reduce((s, t) => s + computePaperTradePnL(t), 0);

  const handleTrade = useCallback((stock: StockData, signal: ORBSignal, orb: ORBRange, reentryCount = 0) => {
    if (orbBias === "bullish" && signal.type !== "bullish") {
      toast.error("NIFTY is BULLISH — only long trades allowed"); return;
    }
    if (orbBias === "bearish" && signal.type !== "bearish") {
      toast.error("NIFTY is BEARISH — only short trades allowed"); return;
    }
    // Neutral: allow both directions — no gate needed
    if (todayTradeCount >= 10) {
      toast.error("Max 10 trades per day reached"); return;
    }
    const price = signal.candle.close;
    const orbRangePct = (orb.high - orb.low) / orb.high;
    const sl = signal.type === "bullish"
      ? (orbRangePct > 0.01 ? price * (1 - 0.013) : orb.low)
      : (orbRangePct > 0.01 ? price * (1 + 0.013) : orb.high);
    const shares = sharesFor20K(price);
    addPaperTrade(stock.symbol, stock.sector, signal, orb, price, reentryCount);
    toast.success(
      reentryCount > 0 ? `Re-entry #${reentryCount}: ${stock.symbol}` : `Trade: ${stock.symbol}`,
      { description: `BO @ ₹${price.toFixed(2)} · SL ₹${sl.toFixed(2)} · ${shares} shares` }
    );
  }, [orbBias, todayTradeCount, addPaperTrade]);

  const handleAutoTrade = useCallback((stock: StockData, signal: ORBSignal, orb: ORBRange, reentryCount = 0) => {
    if (orbBias === "bullish" && signal.type !== "bullish") return;
    if (orbBias === "bearish" && signal.type !== "bearish") return;
    // Neutral: allow both directions
    if (todayTradeCount >= 10) return;
    const price = signal.candle.close;
    const orbRangePct = (orb.high - orb.low) / orb.high;
    const sl = signal.type === "bullish"
      ? (orbRangePct > 0.01 ? price * (1 - 0.013) : orb.low)
      : (orbRangePct > 0.01 ? price * (1 + 0.013) : orb.high);
    const shares = sharesFor20K(price);
    addPaperTrade(stock.symbol, stock.sector, signal, orb, price, reentryCount);
    toast.info(
      `Auto: ${stock.symbol} ${signal.type === "bullish" ? "▲" : "▼"}`,
      { description: `BO @ ₹${price.toFixed(2)} · SL ₹${sl.toFixed(2)} · ${shares} shares @ ₹30K` }
    );
  }, [orbBias, todayTradeCount, addPaperTrade]);

  const handleAutoExit = useCallback((id: string, exitPrice: number) => {
    const trade = paperTrades.find(t => t.id === id);
    exitTrade(id, exitPrice, "SL_HIT");
    if (trade) toast.warning(`SL hit: ${trade.symbol}`, { description: `Exit @ ₹${exitPrice.toFixed(2)}` });
  }, [exitTrade, paperTrades]);

  const handleAutoUpdate = useCallback((id: string, updates: Partial<PaperTrade>) => {
    updateTrade(id, updates);
  }, [updateTrade]);

  return (
    <div className="space-y-4 p-1">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <div className="relative">
              <Target className="h-6 w-6 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
              <span className="absolute inset-0 h-6 w-6 rounded-full bg-primary/20 animate-ping opacity-40" />
            </div>
            ORB Strategy
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Opening Range Breakout · 9:15–9:30 AM · Auto-detects breakouts on strong sector stocks
          </p>
        </div>

        {/* Live market bias strip */}
        <div className="flex items-center gap-3 flex-wrap">
          <BiasPill bias={niftyBias} />
          {advanceDecline.total > 0 && <ADIndicator ad={advanceDecline} />}
          {vix && (
            <div className="flex items-center gap-1.5 text-xs">
              <Activity className="h-3.5 w-3.5 text-warning" />
              <span className="text-muted-foreground">VIX</span>
              <span className={`font-mono font-bold ${vix.changePercent >= 0 ? "text-bearish" : "text-bullish"}`}>
                {vix.value.toFixed(2)}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
            <CircleDot className="h-3 w-3" />
            <span>{watchlist.length} stocks tracked</span>
          </div>
        </div>
      </div>

      {/* ── Strategy Logic Banner ── */}
      <div className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${
        orbBias === "bullish"
          ? "border-bullish/20 bg-bullish/5"
          : orbBias === "bearish"
          ? "border-bearish/20 bg-bearish/5"
          : "border-border/30 bg-accent/10"
      }`}>
        <div className="flex items-start gap-3 flex-1">
          <Zap className={`h-4 w-4 mt-0.5 shrink-0 ${
            orbBias === "bullish" ? "text-bullish" : orbBias === "bearish" ? "text-bearish" : "text-muted-foreground"
          }`} />
          <div className="text-sm">
            <span className="font-semibold text-foreground">Active Strategy: </span>
            {orbBias === "bullish" && (
              <span className="text-muted-foreground">
                NIFTY is <span className="text-bullish font-semibold">bullish</span> → Watching top {activeSectors.length} sectors for ORB <span className="text-bullish font-semibold">high breakouts</span>. Entry: ATM <span className="text-bullish font-semibold">CE</span> when 5-min candle closes above ORB high.
              </span>
            )}
            {orbBias === "bearish" && (
              <span className="text-muted-foreground">
                NIFTY is <span className="text-bearish font-semibold">bearish</span> → Watching top {activeSectors.length} sectors for ORB <span className="text-bearish font-semibold">low breakdowns</span>. Entry: ATM <span className="text-bearish font-semibold">PE</span> when 5-min candle closes below ORB low.
              </span>
            )}
            {orbBias === "neutral" && (
              <span className="text-muted-foreground">
                NIFTY is <span className="font-semibold">neutral</span> — using <span className="text-warning font-semibold">Advance/Decline ({advanceDecline.advancing}↑ {advanceDecline.declining}↓, {advanceDecline.ratio >= 99 ? "∞" : advanceDecline.ratio.toFixed(1)}x)</span> for direction.
                Taking <span className="text-bullish font-semibold">CE</span> on top advancing sector stocks <span className="text-muted-foreground/60">&amp;</span> <span className="text-bearish font-semibold">PE</span> on top declining sector stocks.
              </span>
            )}
          </div>
        </div>
        <SectorPills sectors={activeSectors} />
      </div>

      {/* ── Main Content ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

        {/* ── Left: Sector Strength + Watchlist ── */}
        <div className="xl:col-span-2 space-y-3">

          {/* Live Sector Rotation widget */}
          <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary animate-pulse" />
                Live Sector Rotation
                <Badge variant="outline" className="ml-auto text-xs h-5 px-2 border-primary/30 text-primary">LIVE</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-0.5 max-h-[260px] overflow-auto">
                {sectorStrengths.map((sec, i) => {
                  const up = sec.avgChange >= 0;
                  const isActive = activeSectors.some(a => a.name === sec.name);
                  const barWidth = Math.min(Math.abs(sec.avgChange) * 20, 100);
                  return (
                    <div key={sec.name} className={`relative flex items-center gap-2 px-2 py-1.5 rounded-md text-xs overflow-hidden ${
                      isActive ? "border border-border/40" : ""
                    }`}>
                      {/* Background bar */}
                      <div
                        className={`absolute left-0 top-0 h-full opacity-10 transition-all ${up ? "bg-bullish" : "bg-bearish"}`}
                        style={{ width: `${barWidth}%` }}
                      />
                      <span className="text-muted-foreground/40 w-4 shrink-0 font-mono relative">{i + 1}</span>
                      <span className="flex-1 font-medium text-foreground/80 truncate relative">{sec.name}</span>
                      <div className="flex items-center gap-1.5 relative">
                        {isActive && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/40 text-primary/80">active</Badge>
                        )}
                        <span className={`font-mono font-bold text-xs ${up ? "text-bullish" : "text-bearish"}`}>
                          {up ? "+" : ""}{sec.avgChange.toFixed(2)}%
                        </span>
                        {up ? <ArrowUpRight className="h-3 w-3 text-bullish" /> : <ArrowDownRight className="h-3 w-3 text-bearish" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Watchlist */}
          <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                ORB Watchlist
                <span className="text-xs text-muted-foreground font-normal">{watchlist.length} stocks</span>
                {snapshotTime && (
                  <span className="text-[10px] text-muted-foreground/50 font-normal">
                    · snapshot {snapshotTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  {isActiveOverridden && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-primary/70 hover:text-primary border border-primary/20"
                      onClick={restoreBaseSnapshot}
                      title="Restore 9:30 AM snapshot"
                    >
                      ↩ 9:30 AM
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={takeSnapshot}
                    title="Take new snapshot from current live data"
                    disabled={!isLoadingData === false && watchlist.length === 0 && !hasSnapshot}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              {watchlist.length === 0 ? (
                <div className="text-center py-8">
                  {isLoadingData && !hasSnapshot ? (
                    <>
                      <Loader2 className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2 animate-spin" />
                      <p className="text-sm text-muted-foreground">Fetching market data...</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Connecting to broker API</p>
                    </>
                  ) : !hasSnapshot && !isLoadingData ? (
                    <>
                      <AlertTriangle className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Waiting for 9:30 AM snapshot</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Snapshot auto-captures at 9:25 AM IST</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 h-7 text-xs gap-1"
                        onClick={takeSnapshot}
                      >
                        <RotateCcw className="h-3 w-3" /> Take Snapshot Now
                      </Button>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No stocks met criteria at snapshot time</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">No stocks moved &gt;±2% from active sectors at snapshot</p>
                    </>
                  )}
                </div>
              ) : (
                <ScrollArea className="h-[420px] pr-1">
                  <div className="space-y-0.5">
                    {watchlist.map(stock => (
                      <StockSignalRow
                        key={stock.symbol}
                        stock={stock}
                        isSelected={selectedSymbol === stock.symbol}
                        onSelect={() => setSelectedSymbol(stock.symbol)}
                        onTrade={(signal, orb, rc) => handleTrade(stock, signal, orb, rc)}
                        niftyBias={orbBias}
                        paperTrades={paperTrades}
                        onAutoTrade={(signal, orb, rc) => handleAutoTrade(stock, signal, orb, rc)}
                        onAutoExit={(id, price) => handleAutoExit(id, price)}
                        onUpdateTrade={(id, updates) => handleAutoUpdate(id, updates)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right: Chart + Paper Trades ── */}
        <div className="xl:col-span-3 space-y-3">

          {/* ORB Chart / Trade Detail Chart */}
          <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" />
                {selectedTradeForChart ? (
                  <>
                    <span className={`font-bold ${selectedTradeForChart.direction === "bullish" ? "text-bullish" : "text-bearish"}`}>
                      {selectedTradeForChart.symbol}
                    </span>
                    <span className="text-muted-foreground/50 font-normal">— Trade Detail</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-xs text-muted-foreground ml-auto"
                      onClick={() => setSelectedTradeForChart(null)}
                    >
                      <ChevronRight className="h-3 w-3 rotate-180 mr-0.5" /> Back to ORB
                    </Button>
                  </>
                ) : selectedSymbol ? (
                  <>
                    {selectedSymbol} <span className="text-muted-foreground/50 font-normal">— Intraday 5-min ORB</span>
                    <div className="flex items-center gap-3 ml-auto text-xs">
                      <span className="flex items-center gap-1 text-bullish/80">
                        <span className="inline-block h-px w-4 border-t-2 border-dashed border-bullish/70" />
                        H
                      </span>
                      <span className="flex items-center gap-1 text-bearish/80">
                        <span className="inline-block h-px w-4 border-t-2 border-dashed border-bearish/70" />
                        L
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="text-muted-foreground/50 font-normal">Select a stock from the watchlist</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              {selectedTradeForChart ? (
                <TradeDetailChart
                  trade={selectedTradeForChart}
                  height={320}
                  onBack={() => setSelectedTradeForChart(null)}
                />
              ) : selectedSymbol ? (
                <ORBChart symbol={selectedSymbol} height={320} />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2" style={{ height: 320 }}>
                  <Target className="h-8 w-8 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">Click any stock in the watchlist to view its ORB chart</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Today's ORB Simulation */}
          <TodaySimWidget />

          {/* Paper Trades Panel */}
          <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                <ShieldAlert className="h-4 w-4 text-primary" />
                Paper Trades
                {/* Mode toggle */}
                <div className="flex items-center bg-muted/50 rounded-md p-0.5 gap-0.5">
                  <button
                    onClick={() => setTradeMode("delivery")}
                    className={`text-xs px-2.5 py-0.5 rounded transition-all font-medium ${
                      tradeMode === "delivery"
                        ? "bg-card shadow text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Stock
                  </button>
                  <button
                    onClick={() => setTradeMode("options")}
                    className={`text-xs px-2.5 py-0.5 rounded transition-all font-medium ${
                      tradeMode === "options"
                        ? "bg-card shadow text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Options
                  </button>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  {openTrades.length > 0 && (
                    <Badge variant="outline" className="text-xs h-5 border-primary/40 text-primary gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      {openTrades.length} open
                    </Badge>
                  )}
                  {paperTrades.length > 0 && (
                    <Badge
                      variant="outline"
                      className={`text-xs h-5 font-mono ${totalPnL >= 0 ? "border-bullish/40 text-bullish" : "border-bearish/40 text-bearish"}`}
                    >
                      {totalPnL >= 0 ? "+" : ""}₹{totalPnL.toFixed(0)}
                      <span className="ml-1 text-muted-foreground/50">{tradeMode === "delivery" ? "stk" : "opt"}</span>
                    </Badge>
                  )}
                  {paperTrades.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 text-xs text-muted-foreground/50 hover:text-bearish px-1"
                      onClick={clearTrades}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <Tabs defaultValue="open">
                <TabsList className="h-7 mb-3">
                  <TabsTrigger value="open" className="text-xs h-6 gap-1 px-3">
                    Open <span className="text-primary font-bold">{openTrades.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="closed" className="text-xs h-6 gap-1 px-3">
                    Closed <span className="text-muted-foreground">{closedTrades.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="summary" className="text-xs h-6 px-3">Summary</TabsTrigger>
                </TabsList>

                <TabsContent value="open">
                  {openTrades.length === 0 ? (
                    <div className="py-10 text-center">
                      <Target className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No open paper trades</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        Click the CE/PE button on a breakout stock to add a trade
                      </p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[260px]">
                      <div className="space-y-2 pr-1">
                        {openTrades.map(t => (
                          <PaperTradeRow key={t.id} trade={t} tradeMode={tradeMode}
                            onExit={(id, price) => { exitTrade(id, price); toast.info("Trade closed at market price"); }}
                            onViewChart={(trade) => { setSelectedTradeForChart(trade); setSelectedSymbol(trade.symbol); }}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>

                <TabsContent value="closed">
                  {closedTrades.length === 0 ? (
                    <div className="py-10 text-center">
                      <CheckCircle2 className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No closed trades yet</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[260px]">
                      <div className="space-y-2 pr-1">
                        {closedTrades.map(t => (
                          <PaperTradeRow key={t.id} trade={t} tradeMode={tradeMode} onExit={() => {}}
                            onViewChart={(trade) => { setSelectedTradeForChart(trade); setSelectedSymbol(trade.symbol); }}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>

                <TabsContent value="summary">
                  {paperTrades.length === 0 ? (
                    <div className="py-10 text-center">
                      <BarChart2 className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No trades to summarise</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: "Total Trades", value: paperTrades.length, mono: false },
                        { label: "Open", value: openTrades.length, mono: false },
                        { label: "Closed", value: closedTrades.length, mono: false },
                        {
                          label: "Winners",
                          value: closedTrades.filter(t => computePaperTradePnL(t) > 0).length,
                          mono: false,
                        },
                        {
                          label: "Losers",
                          value: closedTrades.filter(t => computePaperTradePnL(t) < 0).length,
                          mono: false,
                        },
                        {
                          label: "Net P&L (est.)",
                          value: `${totalPnL >= 0 ? "+" : ""}₹${totalPnL.toFixed(0)}`,
                          pnl: totalPnL,
                          mono: true,
                        },
                      ].map(item => (
                        <div key={item.label} className="rounded-lg border border-border/30 bg-accent/10 p-3 text-center">
                          <p className="text-xs text-muted-foreground/70 mb-1">{item.label}</p>
                          <p className={`text-base font-bold ${
                            item.mono
                              ? (item.pnl ?? 0) >= 0 ? "text-bullish font-mono" : "text-bearish font-mono"
                              : "text-foreground"
                          }`}>
                            {item.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── 30-Day ORB Backtest — All F&O Stocks ── */}
      <AllFnOBacktest highlightSymbol={selectedSymbol} />

      {/* ── How It Works ── */}
      <Card className="border-border/30 bg-accent/5">
        <CardContent className="py-4 px-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
            {[
              { n: "1", t: "Market Bias", d: "NIFTY sectoral analysis determines overall market direction (Bullish / Bearish)" },
              { n: "2", t: "Strong Sectors", d: "Top 3 sectors aligned with market bias → 3 strongest stocks per sector populate the watchlist (locked once built, refresh manually)" },
              { n: "3", t: "ORB Breakout", d: "9:15–9:30 AM high/low forms the Opening Range. A 5-min candle closing above ORB high (bullish) or below ORB low (bearish) triggers a signal." },
              { n: "4", t: "Paper Trade", d: "ATM CE (bullish breakout) or PE (bearish breakdown) logged with estimated P&L. Δ ≈ 0.5 approximation used." },
            ].map(s => (
              <div key={s.n} className="flex gap-2.5">
                <div className="h-6 w-6 rounded-full bg-primary/12 text-primary flex items-center justify-center text-xs font-bold shrink-0">{s.n}</div>
                <div>
                  <p className="font-semibold text-foreground text-xs">{s.t}</p>
                  <p className="text-muted-foreground/70 mt-0.5 leading-relaxed">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
