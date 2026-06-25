import { useRef, useEffect, useMemo } from "react";
import {
  createChart, createSeriesMarkers, ColorType,
  CandlestickSeries, HistogramSeries, LineSeries,
  type IChartApi, type Time,
} from "lightweight-charts";
import { useIsDark, getChartColors } from "@/hooks/useIsDark";
import { useIntradayCandles, computeEMA, sharesFor20K } from "@/hooks/useORBStrategy";
import { Loader2, BarChart2, ArrowUpRight, ArrowDownRight, ShieldAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface TradeChartInfo {
  symbol: string;
  direction: "bullish" | "bearish";
  entryStockPrice: number;
  exitStockPrice?: number | null;
  entryTime: number;    // ms
  exitTime?: number | null; // ms
  orbHigh: number;
  orbLow: number;
  slPrice: number;
  target1?: number | null;  // 1R level
  target2?: number | null;  // 2R level (partial exit + EMA9 trail begins)
  status: string;
  sector?: string;
}

interface TradeDetailChartProps {
  trade: TradeChartInfo;
  height?: number;
  onBack?: () => void;
}

export function TradeDetailChart({ trade, height = 320, onBack }: TradeDetailChartProps) {
  const chartRef = useRef<IChartApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark();
  // Derive the trade's date (YYYY-MM-DD in IST) from entryTime so historical charts load correctly
  const tradeDate = new Date(trade.entryTime + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isToday = tradeDate === today;
  const { data: candles = [], isLoading } = useIntradayCandles(trade.symbol, true, tradeDate);

  const emas9 = useMemo(() => candles.length ? computeEMA(candles, 9) : [], [candles]);

  const entryTs = Math.floor(trade.entryTime / 1000);
  const exitTs = trade.exitTime ? Math.floor(trade.exitTime / 1000) : null;

  // Delivery P&L for the info strip
  const shares = sharesFor20K(trade.entryStockPrice);
  const liveSpot = candles.length > 0 ? candles[candles.length - 1].close : trade.entryStockPrice;
  const exitPx = trade.exitStockPrice ?? liveSpot;
  const pnl = (trade.direction === "bullish"
    ? exitPx - trade.entryStockPrice
    : trade.entryStockPrice - exitPx) * shares;

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
    candleSeries.setData(candles.map(c => ({
      time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    // ORB High / Low
    (candleSeries as any).createPriceLine({
      price: trade.orbHigh, color: "rgba(52, 211, 153, 0.85)",
      lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title: "ORB H",
    });
    (candleSeries as any).createPriceLine({
      price: trade.orbLow, color: "rgba(248, 113, 113, 0.85)",
      lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title: "ORB L",
    });

    // Entry price (violet dashed)
    (candleSeries as any).createPriceLine({
      price: trade.entryStockPrice, color: "rgba(167, 139, 250, 0.9)",
      lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: "Entry",
    });

    // SL at ORB Low/High (structural stop, red dotted)
    (candleSeries as any).createPriceLine({
      price: trade.slPrice, color: "rgba(239, 68, 68, 0.8)",
      lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: "SL",
    });

    // T1 — 1:1 target (green dashed)
    if (trade.target1) {
      (candleSeries as any).createPriceLine({
        price: trade.target1, color: "rgba(34, 197, 94, 0.75)",
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `T1 ${trade.target1.toFixed(1)}`,
      });
    }
    // T2 — 2R target (purple dashed)
    if (trade.target2) {
      (candleSeries as any).createPriceLine({
        price: trade.target2, color: "rgba(168, 85, 247, 0.75)",
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `T2 ${trade.target2.toFixed(1)}`,
      });
    }

    // Exit price (only if closed)
    if (trade.exitStockPrice != null && trade.status !== "OPEN") {
      (candleSeries as any).createPriceLine({
        price: trade.exitStockPrice,
        color: pnl >= 0 ? "rgba(74, 222, 128, 0.9)" : "rgba(248, 113, 113, 0.9)",
        lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: "Exit",
      });
    }

    // Entry / exit markers
    const markers: any[] = [];
    if (candles.length > 0) {
      const closestEntry = candles.reduce((best, c) =>
        Math.abs(c.time - entryTs) < Math.abs(best.time - entryTs) ? c : best, candles[0]);
      markers.push({
        time: closestEntry.time as Time,
        position: trade.direction === "bullish" ? "belowBar" : "aboveBar",
        color: "rgba(167, 139, 250, 0.95)",
        shape: trade.direction === "bullish" ? "arrowUp" : "arrowDown",
        text: `Entry ₹${trade.entryStockPrice.toFixed(0)}`,
        size: 2,
      });

      if (exitTs && trade.exitStockPrice != null) {
        const closestExit = candles.reduce((best, c) =>
          Math.abs(c.time - exitTs) < Math.abs(best.time - exitTs) ? c : best, candles[0]);
        markers.push({
          time: closestExit.time as Time,
          position: trade.direction === "bullish" ? "aboveBar" : "belowBar",
          color: pnl >= 0 ? "rgba(74, 222, 128, 0.9)" : "rgba(248, 113, 113, 0.9)",
          shape: "circle",
          text: `Exit ₹${trade.exitStockPrice.toFixed(0)}`,
          size: 1.5,
        });
      }

      markers.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candleSeries, markers);
    }

    // EMA9 line (amber — visual Trailing SL)
    if (emas9.length === candles.length) {
      const ema9Series = chart.addSeries(LineSeries, {
        color: "rgba(251, 191, 36, 0.85)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: "EMA9",
      });
      ema9Series.setData(
        candles
          .map((c, i) => ({ time: c.time as Time, value: emas9[i] }))
          .filter(d => d.value > 0),
      );

      // Trailing SL — phase-aware:
      //   Phase 1 (before T1): fixed at ORB Low/High (initial structural SL)
      //   Phase 2 (after T1, before T3): fixed at entry price (cost-to-cost)
      //   Phase 3 (after T3): trails EMA9
      const isBull = trade.direction === "bullish";
      const t1 = trade.target1 ?? null;
      const t2 = trade.target2 ?? null;
      let slPhase: 1 | 2 | 3 = 1;
      const trailSLData = candles
        .map((c, i) => {
          if (c.time < entryTs) return null;
          // Advance phase based on price reaching T1/T2
          if (slPhase === 1 && t1 !== null && (isBull ? c.high >= t1 : c.low <= t1)) slPhase = 2;
          if (slPhase === 2 && t2 !== null && (isBull ? c.high >= t2 : c.low <= t2)) slPhase = 3;
          const ema = emas9[i] ?? 0;
          let tsl: number;
          if (slPhase === 1) {
            tsl = isBull ? trade.slPrice : trade.slPrice;   // ORB boundary
          } else if (slPhase === 2) {
            tsl = trade.entryStockPrice;                     // cost-to-cost
          } else {
            // Trail EMA9 (only move in favour, never backward)
            tsl = isBull
              ? Math.max(trade.entryStockPrice, ema > 0 ? ema : trade.entryStockPrice)
              : Math.min(trade.entryStockPrice, ema > 0 ? ema : trade.entryStockPrice);
          }
          return { time: c.time as Time, value: tsl };
        })
        .filter(Boolean) as { time: Time; value: number }[];

      if (trailSLData.length > 0) {
        const trailSLSeries = chart.addSeries(LineSeries, {
          color: "rgba(239, 68, 68, 0.75)",
          lineWidth: 2,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: "Trail SL",
        });
        trailSLSeries.setData(trailSLData);
      }
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
    ro.observe(containerRef.current!);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, emas9, isDark, height,
    trade.orbHigh, trade.orbLow, trade.entryStockPrice, trade.exitStockPrice,
    trade.slPrice, trade.target1, trade.target2, trade.direction, trade.status, entryTs, exitTs, pnl]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading chart...
        </div>
      </div>
    );
  }

  if (candles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2" style={{ height }}>
        <BarChart2 className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">
          {isToday ? "Intraday data not yet available" : `No 5-min data for ${tradeDate}`}
        </p>
        <p className="text-xs text-muted-foreground/60">
          {isToday
            ? "Chart will appear once the market opens"
            : "Historical intraday data requires Dhan credentials configured in Settings"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Info strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs px-1">
        <div className={`flex items-center gap-1 font-semibold ${trade.direction === "bullish" ? "text-bullish" : "text-bearish"}`}>
          {trade.direction === "bullish" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {trade.direction.toUpperCase()}
        </div>
        <span className="text-muted-foreground font-mono">Entry ₹{trade.entryStockPrice.toFixed(2)}</span>
        {trade.exitStockPrice != null && (
          <span className="text-muted-foreground/70 font-mono">→ ₹{trade.exitStockPrice.toFixed(2)}</span>
        )}
        <span className="flex items-center gap-1 text-warning/80 font-mono">
          <ShieldAlert className="h-3 w-3" /> SL ₹{trade.slPrice.toFixed(2)}
        </span>
        <Badge
          variant="outline"
          className={`font-mono ${pnl >= 0 ? "border-bullish/40 text-bullish" : "border-bearish/40 text-bearish"}`}
        >
          {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(0)} · {shares}sh
        </Badge>
        <div className="flex items-center gap-2 ml-auto text-muted-foreground/50">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "rgba(251,191,36,0.85)" }} /> EMA9/Trail
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded border-t-2 border-dashed" style={{ borderColor: "rgba(239,68,68,0.75)" }} /> Trail SL
          </span>
          {onBack && (
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={onBack}>
              <X className="h-3 w-3 mr-1" /> Back
            </Button>
          )}
        </div>
      </div>
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
    </div>
  );
}
