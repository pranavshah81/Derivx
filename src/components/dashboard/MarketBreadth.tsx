import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAllIndices, useFnOStocks } from "@/hooks/useMarketData";
import { useWebSocketVix } from "@/hooks/useWebSocket";
import { Activity, ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";

export function MarketBreadth() {
  const { data: indexData } = useAllIndices();
  const { vix: wsVix } = useWebSocketVix();
  const { data: fnoData } = useFnOStocks();

  const advances = indexData?.advances ?? 0;
  const declines = indexData?.declines ?? 0;
  const unchanged = indexData?.unchanged ?? 0;
  const total = advances + declines + unchanged;
  const isLive = indexData?.isLive || false;

  const vix = wsVix?.value ?? indexData?.vix?.value ?? null;
  const vixChange = wsVix?.changePercent ?? indexData?.vix?.changePercent ?? null;

  const sectors = indexData?.sectors || [];
  const bullishSectors = sectors.filter((s: any) => s.change > 0).length;
  const bearishSectors = sectors.filter((s: any) => s.change < 0).length;

  const allStocks = fnoData?.allStocks || [];
  const stocksUp = allStocks.filter(s => s.changePercent > 0).length;
  const stocksDown = allStocks.filter(s => s.changePercent < 0).length;
  const totalStocks = allStocks.length;

  const sentimentScore = useMemo(() => {
    let score = 50;
    if (total > 0) score += ((advances - declines) / total) * 25;
    if (vix) {
      if (vix < 12) score += 10;
      else if (vix < 15) score += 5;
      else if (vix > 20) score -= 10;
      else if (vix > 25) score -= 15;
    }
    if (totalStocks > 0) score += ((stocksUp - stocksDown) / totalStocks) * 15;
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [advances, declines, total, vix, stocksUp, stocksDown, totalStocks]);

  const sentimentLabel = sentimentScore >= 70 ? "Strong Bullish" : sentimentScore >= 55 ? "Bullish" : sentimentScore >= 45 ? "Neutral" : sentimentScore >= 30 ? "Bearish" : "Strong Bearish";
  const sentimentColor = sentimentScore >= 55 ? "text-bullish" : sentimentScore >= 45 ? "text-warning" : "text-bearish";

  const vixColor = vix && vix > 20 ? "text-bearish" : vix && vix < 13 ? "text-bullish" : "text-warning";
  const vixRegime = vix ? (vix > 25 ? "Extreme Fear" : vix > 20 ? "High Vol" : vix > 15 ? "Normal" : vix > 12 ? "Low Vol" : "Complacency") : "—";
  const adRatio = declines > 0 ? (advances / declines).toFixed(2) : advances > 0 ? "∞" : "—";
  const adBullish = advances > declines;

  if (!isLive && totalStocks === 0) {
    return (
      <Card className="hover:shadow-card-hover transition-all duration-300">
        <CardContent className="py-8 text-center">
          <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-sm font-semibold text-muted-foreground">Market breadth unavailable</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Loads during market hours</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-card-hover transition-all duration-300">
      <CardHeader className="pb-2 pt-4 px-5 bg-gradient-to-r from-primary/5 to-transparent">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.5)]" />
          Market Breadth
          {isLive && <Badge variant="outline" className="text-xs h-5 px-2 border-bullish/30 text-bullish ml-auto">LIVE</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4 space-y-4">

        {/* Sentiment score + gauge */}
        <div className="flex items-center gap-4">
          <div className="text-center shrink-0">
            <p className={`text-3xl font-bold font-mono leading-none ${sentimentColor}`}>{sentimentScore}</p>
            <p className={`text-xs font-semibold uppercase tracking-wide mt-1 ${sentimentColor}`}>{sentimentLabel}</p>
          </div>
          <div className="flex-1 space-y-1">
            <div className="relative h-3 rounded-full bg-gradient-to-r from-bearish/40 via-warning/40 to-bullish/40 overflow-hidden">
              <div
                className="absolute top-0 h-full w-1.5 bg-foreground rounded-full shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all duration-500"
                style={{ left: `${sentimentScore}%`, transform: "translateX(-50%)" }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>Bearish</span><span>Neutral</span><span>Bullish</span>
            </div>
          </div>
        </div>

        <div className="border-t border-border/40" />

        {/* A/D + VIX in one row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Advance / Decline */}
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Advance / Decline</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-bullish">
                <ArrowUpRight className="h-4 w-4" />
                <span className="text-xl font-bold font-mono">{advances}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{unchanged}–</span>
              <div className="flex items-center gap-1 text-bearish">
                <span className="text-xl font-bold font-mono">{declines}</span>
                <ArrowDownRight className="h-4 w-4" />
              </div>
            </div>
            {total > 0 && (
              <>
                <div className="flex h-2 rounded-full overflow-hidden gap-px">
                  <div className="bg-bullish/80 transition-all" style={{ width: `${(advances / total) * 100}%` }} />
                  <div className="bg-muted-foreground/20" style={{ width: `${(unchanged / total) * 100}%` }} />
                  <div className="bg-bearish/80 transition-all" style={{ width: `${(declines / total) * 100}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Ratio: <span className={`font-mono font-bold ${adBullish ? "text-bullish" : "text-bearish"}`}>{adRatio}</span>
                </p>
              </>
            )}
          </div>

          {/* VIX */}
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">India VIX</p>
            <div className="flex items-baseline gap-2">
              <span className={`text-xl font-bold font-mono ${vixColor}`}>{vix !== null ? vix.toFixed(2) : "—"}</span>
              {vixChange !== null && (
                <span className={`text-xs font-mono font-semibold ${vixChange < 0 ? "text-bullish" : "text-bearish"}`}>
                  {vixChange >= 0 ? "+" : ""}{vixChange.toFixed(2)}%
                </span>
              )}
            </div>
            <div className="flex justify-between items-center px-2 py-1.5 rounded bg-accent/30 border border-white/5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Regime</span>
              <span className={`text-xs font-bold ${vixColor}`}>{vixRegime}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Strategy: <span className="font-semibold text-foreground/80">{vix ? (vix > 20 ? "Iron Condors" : vix < 13 ? "Buy Straddles" : "Neutral") : "—"}</span>
            </p>
          </div>
        </div>

        <div className="border-t border-border/40" />

        {/* F&O Breadth */}
        {totalStocks > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">F&O Stocks ({totalStocks})</p>
            <div className="flex items-center gap-3">
              <span className="text-bullish font-bold font-mono text-lg">{stocksUp}↑</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden bg-bearish/20">
                <div className="h-full bg-bullish/70 rounded-full transition-all" style={{ width: `${(stocksUp / totalStocks) * 100}%` }} />
              </div>
              <span className="text-bearish font-bold font-mono text-lg">{stocksDown}↓</span>
            </div>
            <div className="flex gap-4 text-[11px]">
              <span className="text-muted-foreground">Sectors: <span className="text-bullish font-bold">{bullishSectors}▲</span></span>
              <span className="text-muted-foreground"><span className="text-bearish font-bold">{bearishSectors}▼</span></span>
            </div>
          </div>
        ) : (
          <div className="py-2 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/30 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Loading F&O data...</p>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
