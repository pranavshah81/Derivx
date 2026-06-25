import { Fragment, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Flame } from "lucide-react";
import { type OptionData } from "@/lib/mockData";

const STRIKES_EACH_SIDE = 15;

interface OIHeatmapProps {
  chain: OptionData[];
  spotPrice: number;
  stepSize?: number;
}

export function OIHeatmap({ chain, spotPrice, stepSize = 50 }: OIHeatmapProps) {
  const heatmapData = useMemo(() => {
    if (chain.length === 0) return [];

    const step = stepSize > 0 ? stepSize : 50;
    const atmStrike = Math.round(spotPrice / step) * step;

    // Sort and pick ATM ± STRIKES_EACH_SIDE by index
    const sorted = [...chain].sort((a, b) => a.strikePrice - b.strikePrice);
    let atmIdx = sorted.findIndex(o => o.strikePrice >= atmStrike);
    if (atmIdx === -1) atmIdx = sorted.length - 1;
    const start = Math.max(0, atmIdx - STRIKES_EACH_SIDE);
    const end = Math.min(sorted.length, atmIdx + STRIKES_EACH_SIDE + 1);
    const zone = sorted.slice(start, end);

    const maxOI = Math.max(...zone.map(o => Math.max(o.ce.oi, o.pe.oi)), 1);

    return zone.map(o => ({
      strike: o.strikePrice,
      ceIntensity: o.ce.oi / maxOI,
      peIntensity: o.pe.oi / maxOI,
      ceOI: o.ce.oi,
      peOI: o.pe.oi,
      ceOIChg: o.ce.oiChange,
      peOIChg: o.pe.oiChange,
      isATM: Math.abs(o.strikePrice - atmStrike) < step,
    }));
  }, [chain, spotPrice, stepSize]);

  const getColor = (intensity: number, type: "call" | "put") => {
    const alpha = 0.08 + intensity * 0.88;
    return type === "call"
      ? `hsl(142 71% 45% / ${alpha})`
      : `hsl(0 84% 60% / ${alpha})`;
  };

  return (
    <Card className="overflow-hidden border-border/80 bg-card/95">
      <CardHeader className="border-b border-border/70 bg-muted/25 px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Flame className="h-4 w-4" /> OI Heatmap
          </CardTitle>
          <span className="text-[11px] text-muted-foreground font-mono">ATM ±{STRIKES_EACH_SIDE} strikes</span>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {/* Legend */}
        <div className="mb-3 grid grid-cols-[1fr_60px_1fr] gap-0.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="h-2 flex-1 rounded-full border border-border/40"
              style={{ background: "linear-gradient(90deg, hsl(142 71% 45% / 0.08), hsl(142 71% 45% / 0.95))" }} />
            <span className="text-bullish font-medium shrink-0">CE High →</span>
          </div>
          <div />
          <div className="flex items-center gap-1.5">
            <span className="text-bearish font-medium shrink-0">← PE High</span>
            <div className="h-2 flex-1 rounded-full border border-border/40"
              style={{ background: "linear-gradient(90deg, hsl(0 84% 60% / 0.95), hsl(0 84% 60% / 0.08))" }} />
          </div>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_72px_1fr] gap-0.5 mb-1">
          <div className="text-center text-[11px] font-semibold text-bullish">CALL OI</div>
          <div className="text-center text-[11px] font-semibold text-muted-foreground">STRIKE</div>
          <div className="text-center text-[11px] font-semibold text-bearish">PUT OI</div>
        </div>

        {/* Scrollable heatmap rows */}
        <div className="overflow-auto max-h-[420px]">
          <div className="grid grid-cols-[1fr_72px_1fr] gap-0.5">
            {heatmapData.map(d => (
              <Fragment key={d.strike}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="flex h-6 cursor-default items-center justify-end rounded-sm pr-1.5 transition-all hover:ring-1 hover:ring-foreground/25"
                      style={{ backgroundColor: getColor(d.ceIntensity, "call") }}
                    >
                      <span className="text-[11px] font-mono">{(d.ceOI / 1000).toFixed(0)}K</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs">
                    <p>CE OI: {(d.ceOI / 100000).toFixed(2)}L</p>
                    <p className={d.ceOIChg >= 0 ? "text-bullish" : "text-bearish"}>
                      Chg: {d.ceOIChg >= 0 ? "+" : ""}{(d.ceOIChg / 1000).toFixed(1)}K
                    </p>
                  </TooltipContent>
                </Tooltip>

                <div
                  className={`flex h-6 items-center justify-center rounded-sm text-[11px] font-mono font-bold ${
                    d.isATM
                      ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                      : "text-muted-foreground"
                  }`}
                >
                  {d.strike.toLocaleString("en-IN")}
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="flex h-6 cursor-default items-center rounded-sm pl-1.5 transition-all hover:ring-1 hover:ring-foreground/25"
                      style={{ backgroundColor: getColor(d.peIntensity, "put") }}
                    >
                      <span className="text-[11px] font-mono">{(d.peOI / 1000).toFixed(0)}K</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    <p>PE OI: {(d.peOI / 100000).toFixed(2)}L</p>
                    <p className={d.peOIChg >= 0 ? "text-bullish" : "text-bearish"}>
                      Chg: {d.peOIChg >= 0 ? "+" : ""}{(d.peOIChg / 1000).toFixed(1)}K
                    </p>
                  </TooltipContent>
                </Tooltip>
              </Fragment>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
