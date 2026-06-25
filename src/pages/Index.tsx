import { useMemo } from "react";
import { useLiveIndices, useMarketStatus, useExpiryList, useAllIndices, useLiveOptionChain } from "@/hooks/useMarketData";
import { getSpotPrice } from "@/lib/positionStore";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ExpectedMoveWidget } from "@/components/ExpectedMoveWidget";
import { useWebSocketVix } from "@/hooks/useWebSocket";
import { BarChart3, TrendingUp, Activity } from "lucide-react";

import { MarketHeader } from "@/components/dashboard/MarketHeader";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { IndexCards } from "@/components/dashboard/IndexCards";
import { KeyMetrics } from "@/components/dashboard/KeyMetrics";
import { GiftNiftyExpiry } from "@/components/dashboard/GiftNiftyExpiry";
import { TopMovers } from "@/components/dashboard/TopMovers";
import { FuturesVIX } from "@/components/dashboard/FuturesVIX";
import { SectorHeatmap } from "@/components/dashboard/SectorHeatmap";
import { MostActiveFnO } from "@/components/dashboard/MostActiveFnO";
import { MarketBreadth } from "@/components/dashboard/MarketBreadth";
import { SectionHeader } from "@/components/dashboard/SectionHeader";

const EXPIRY_CONTRACTS = [
  { symbol: "NIFTY", exchange: "NSE", lotSize: 25, type: "Weekly" },
  { symbol: "BANKNIFTY", exchange: "NSE", lotSize: 15, type: "Weekly" },
  { symbol: "FINNIFTY", exchange: "NSE", lotSize: 25, type: "Monthly" },
  { symbol: "MIDCPNIFTY", exchange: "NSE", lotSize: 50, type: "Monthly" },
];

function getTimeToExpiry(expiryDate: string): string {
  const expiry = new Date(expiryDate + "T15:30:00+05:30");
  const now = new Date();
  const diff = expiry.getTime() - now.getTime();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days === 0) return `${hours}h left`;
  return `${days}d ${hours}h`;
}

export default function Index() {
  const { data: indicesResult, isLoading: indicesLoading } = useLiveIndices();
  const { data: marketStatusResult } = useMarketStatus();
  const { data: niftyExpiry } = useExpiryList("NIFTY");
  const { data: bnfExpiry } = useExpiryList("BANKNIFTY");
  const { data: allIndicesData } = useAllIndices();
  const { vix: wsVix } = useWebSocketVix();
  const { data: bnfOC } = useLiveOptionChain("BANKNIFTY");

  const indices = indicesResult?.data || [];
  const isLive = indicesResult?.isLive || false;
  const isOpen = marketStatusResult?.isOpen ?? false;
  const marketStatus = marketStatusResult?.status || "Closed";
  const giftNifty = marketStatusResult?.giftNifty;
  const indicativeNifty = marketStatusResult?.indicativeNifty;
  
  // Live VIX value for Expected Move calculations
  const liveVix = wsVix?.value ?? allIndicesData?.vix?.value ?? 0;

  const nearestExpiries = useMemo(() => {
    const nExpiry = niftyExpiry?.expiries?.[0]?.value || "";
    const bnExpiry = bnfExpiry?.expiries?.[0]?.value || "";
    return EXPIRY_CONTRACTS.map((c) => {
      let expDate = "";
      if (c.symbol === "NIFTY") expDate = nExpiry;
      else if (c.symbol === "BANKNIFTY") expDate = bnExpiry;
      else if (c.symbol === "FINNIFTY") expDate = niftyExpiry?.expiries?.[1]?.value || nExpiry;
      else if (c.symbol === "MIDCPNIFTY") expDate = niftyExpiry?.expiries?.[1]?.value || nExpiry;
      else {
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        expDate = lastDay.toISOString().split("T")[0];
      }
      return { ...c, expiry: expDate, timeLeft: expDate ? getTimeToExpiry(expDate) : "N/A" };
    });
  }, [niftyExpiry, bnfExpiry]);

  const getDTE = (sym: string) => {
    const match = nearestExpiries.find((c) => c.symbol === sym)?.timeLeft?.match(/(\d+)d/);
    return match ? parseInt(match[1]) : 4;
  };

  // Real BankNifty IV: ATM straddle ask price / spot / sqrt(DTE/365) × 100
  const bnfSpot = bnfOC?.spotPrice ?? 0;
  const bnfIV = useMemo(() => {
    if (!bnfOC || !(bnfOC.isLive || bnfOC.afterHours) || !bnfSpot) return 0;
    const atmStrike = Math.round(bnfSpot / 100) * 100;
    const atmRow = bnfOC.chain?.find((r: any) => r.strikePrice === atmStrike);
    if (!atmRow) return 0;
    const straddlePrice = (atmRow.ce.askPrice || atmRow.ce.ltp) + (atmRow.pe.askPrice || atmRow.pe.ltp);
    if (straddlePrice <= 0) return 0;
    const dte = getDTE("BANKNIFTY");
    if (dte <= 0) return 0;
    return (straddlePrice / bnfSpot) / Math.sqrt(dte / 365) * 100;
  }, [bnfOC, bnfSpot]);

  if (indicesLoading) return <DashboardSkeleton />;

  return (
    <ErrorBoundary fallbackMessage="Dashboard failed to load">
      <div className="space-y-4 animate-fade-in">

        {/* ── Header + ticker ── */}
        <MarketHeader isLive={isLive} isOpen={isOpen} marketStatus={marketStatus} />
        <TickerTape indices={indices} giftNifty={giftNifty} />

        {/* ── Live indices ── */}
        <IndexCards indices={indices} />

        {/* ── Key metrics: PCR · VIX · Max Pain · A/D ── */}
        <KeyMetrics />

        {/* ── Expected move — NIFTY (real VIX) + BANKNIFTY (ATM straddle IV) ── */}
        {(liveVix > 0 || bnfIV > 0) && (
          <SectionHeader
            title="Expected Move"
            subtitle="NIFTY uses India VIX · BankNifty IV derived from live ATM straddle"
            icon={<TrendingUp className="h-4 w-4" />}
            tooltip="Spot × IV × √(DTE/365). NIFTY uses India VIX; BankNifty IV = (ATM CE ask + ATM PE ask) / spot / √(DTE/365). The 1σ range captures ~68% of outcomes."
          />
        )}
        {(liveVix > 0 || bnfIV > 0) && (
          <div className="grid lg:grid-cols-2 gap-4">
            {liveVix > 0 && (
              <ExpectedMoveWidget
                symbol="NIFTY"
                spotPrice={indices[0]?.ltp || getSpotPrice("NIFTY")}
                iv={liveVix}
                daysToExpiry={getDTE("NIFTY")}
              />
            )}
            {bnfIV > 0 && (
              <ExpectedMoveWidget
                symbol="BANKNIFTY"
                spotPrice={bnfSpot || getSpotPrice("BANKNIFTY")}
                iv={bnfIV}
                daysToExpiry={getDTE("BANKNIFTY")}
              />
            )}
          </div>
        )}

        {/* ── GIFT Nifty + NSE expiry countdown ── */}
        <SectionHeader
          title="Expiry Countdown"
          subtitle="GIFT Nifty pre-market signal · NSE contract time-to-expiry"
          icon={<Activity className="h-4 w-4" />}
          tooltip="GIFT Nifty indicates pre-market direction. Theta decay accelerates in the last 2–3 days before expiry."
        />
        <GiftNiftyExpiry giftNifty={giftNifty} indicativeNifty={indicativeNifty} nearestExpiries={nearestExpiries} />

        {/* ── Top movers ── */}
        <SectionHeader
          title="Top Movers"
          subtitle="Today's biggest F&O gainers & losers"
          icon={<TrendingUp className="h-4 w-4" />}
          tooltip="Largest % change today. Long Buildup / Short Buildup signals shown inline."
        />
        <TopMovers />

        {/* ── Futures premium & VIX ── */}
        <SectionHeader
          title="Futures & Volatility"
          subtitle="Premium/discount · VIX trend"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Futures premium = bullish positioning, discount = bearish. Rising VIX = expensive options, good for selling straddles."
        />
        <FuturesVIX />

        {/* ── Sector heatmap ── */}
        <SectionHeader
          title="Sector Performance"
          subtitle="Click any sector to see top movers within it"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Color intensity = magnitude. Click a sector tile to drill down into its constituent stocks sorted by % change."
        />
        <SectorHeatmap />

        {/* ── Most active F&O + market breadth side-by-side ── */}
        <SectionHeader
          title="F&O Activity & Breadth"
          subtitle="OI build-up signals · Advance/Decline internals"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Long/Short Buildup from OI+price signals. Market breadth shows whether the move has internal participation."
        />
        <div className="grid lg:grid-cols-2 gap-4">
          <MostActiveFnO />
          <MarketBreadth />
        </div>

      </div>
    </ErrorBoundary>
  );
}
