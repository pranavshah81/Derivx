import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAllIndices, useFnOStocks } from "@/hooks/useMarketData";
import { BarChart3, Loader2, X, TrendingUp, TrendingDown } from "lucide-react";

// Static map: NSE sector friendly name → stock symbols
// Mirrors SECTOR_INDEX_MAP names in marketApi.ts
const SECTOR_STOCKS: Record<string, string[]> = {
  Banking: [
    "HDFCBANK","ICICIBANK","AXISBANK","KOTAKBANK","INDUSINDBK","IDFCFIRSTB",
    "FEDERALBNK","BANDHANBNK","RBLBANK","AUBANK","YESBANK","IDBI",
    "SBIN","BANKBARODA","PNB","CANBK","UNIONBANK","INDIANB","MAHABANK","CENTRALBK",
  ],
  "PSU Bank": [
    "SBIN","BANKBARODA","PNB","CANBK","UNIONBANK","INDIANB","MAHABANK","CENTRALBK",
  ],
  IT: [
    "TCS","INFY","HCLTECH","WIPRO","TECHM","LTIM","MPHASIS","COFORGE","PERSISTENT",
    "OFSS","KPITTECH","LTTS","BIRLASOFT","TATAELXSI",
  ],
  FMCG: [
    "HINDUNILVR","ITC","NESTLEIND","BRITANNIA","DABUR","MARICO","COLPAL","GODREJCP",
    "VBL","RADICO","UNITDSPR","PGHH","EMAMILTD","JYOTHYLAB",
  ],
  Pharma: [
    "SUNPHARMA","DRREDDY","CIPLA","DIVISLAB","LUPIN","AUROPHARMA","BIOCON",
    "TORNTPHARM","ALKEM","IPCALAB","LAURUSLABS","GLENMARK","NATCOPHARM","ABBOTINDIA",
  ],
  Health: [
    "SUNPHARMA","DRREDDY","CIPLA","DIVISLAB","LUPIN","AUROPHARMA","BIOCON",
    "TORNTPHARM","ALKEM","IPCALAB","APOLLOHOSP","FORTIS","MAXHEALTH",
    "METROPOLIS","THYROCARE","LAURUSLABS","GLENMARK",
  ],
  Auto: [
    "MARUTI","TATAMOTORS","M&M","BAJAJ-AUTO","HEROMOTOCO","TVSMOTOR","EICHERMOT",
    "ESCORTS","ASHOKLEY","BALKRISIND","BOSCHLTD","MRF","APOLLOTYRE","MOTHERSON",
    "BHARATFORG","TIINDIA","ENDURANCE","MINDAIND",
  ],
  Metal: [
    "TATASTEEL","JSWSTEEL","HINDALCO","VEDL","SAIL","JINDALSTEL","NMDC",
    "NATIONALUM","HINDCOPPER","HINDZINC","COALINDIA","WELCORP",
  ],
  Energy: [
    "ONGC","BPCL","IOC","GAIL","TATAPOWER","NTPC","POWERGRID","ADANIENT",
    "ADANIGREEN","CESC","TORNTPOWER","SUZLON","NHPC","SJVN","COALINDIA",
  ],
  Realty: [
    "DLF","GODREJPROP","OBEROIRLTY","PRESTIGE","PHOENIXLTD","BRIGADE","SOBHA","LODHA",
  ],
  Media: ["SUNTV","ZEEL","PVRINOX","SAREGAMA"],
  "Fin Svc": [
    "BAJFINANCE","BAJAJFINSV","SHRIRAMFIN","CHOLAFIN","MANAPPURAM","MUTHOOTFIN",
    "LICHSGFIN","CANFINHOME","RECLTD","PFC","M&MFIN","SBICARD","POONAWALLA",
    "IIFL","ANGELONE","MOTILALOFS","SBILIFE","HDFCLIFE","LICI","ICICIPRULI","ICICIGI",
  ],
  Infra: [
    "LT","HAL","BEL","BHEL","SIEMENS","ABB","IRCTC","ADANIPORTS","CONCOR",
    "IRFC","RVNL","TITAGARH","JSWINFRA",
  ],
  Consumer: [
    "DIXON","CROMPTON","HAVELLS","VOLTAS","POLYCAB","TITAN","AMBER","BLUESTARCO",
    "KAYNES","VGUARD","BATAINDIA","TRENT","DMART",
  ],
};

// TradingView actual sector field values → NSE friendly sector name
// (verified against live TV scanner output)
const TV_SECTOR_ALIAS: Record<string, string> = {
  "Finance": "Banking",             // TV Finance = banks + NBFCs; static map handles split
  "Technology Services": "IT",
  "Consumer Non-Durables": "FMCG",
  "Health Technology": "Pharma",
  "Health Services": "Health",
  "Consumer Durables": "Auto",      // TV Consumer Durables = cars/bikes in Indian market
  "Producer Manufacturing": "Auto", // auto components, industrials
  "Non-Energy Minerals": "Metal",
  "Energy Minerals": "Energy",
  "Utilities": "Energy",
  "Consumer Services": "Media",     // SUNTV, ZEEL, PVRINOX + IRCTC, JUBLFOOD
  "Industrial Services": "Infra",
  "Electronic Technology": "Consumer",
  "Retail Trade": "Consumer",
  "Communications": "IT",           // BHARTIARTL, IDEA
  "Transportation": "Infra",
  "Process Industries": "FMCG",     // PIDILITIND, paints, chemicals
  "Distribution Services": "Infra",
  "Commercial Services": "IT",
};

function aggregateStocksBySector(stocks: any[]): { name: string; change: number; count: number }[] {
  const symbolMap = new Map<string, any>();
  for (const s of stocks) { if (s.symbol) symbolMap.set(s.symbol, s); }

  // Primary: use the static sector→symbols map so every known sector is represented
  const result: { name: string; change: number; count: number }[] = [];
  for (const [sectorName, symbols] of Object.entries(SECTOR_STOCKS)) {
    const matched = symbols.map(sym => symbolMap.get(sym)).filter(Boolean);
    if (matched.length < 1) continue;
    const total = matched.reduce((sum: number, s: any) => sum + (s.changePercent || 0), 0);
    result.push({
      name: sectorName,
      change: Math.round((total / matched.length) * 100) / 100,
      count: matched.length,
    });
  }

  // Secondary: pick up any stocks with a TV sector field that aren't already counted
  const coveredSymbols = new Set(Object.values(SECTOR_STOCKS).flat());
  const extraMap = new Map<string, { total: number; count: number }>();
  for (const stock of stocks) {
    if (coveredSymbols.has(stock.symbol)) continue;
    const rawSector = stock.sector || "";
    const sector = TV_SECTOR_ALIAS[rawSector] || (rawSector && rawSector !== "undefined" ? rawSector : "");
    if (!sector) continue;
    const entry = extraMap.get(sector) || { total: 0, count: 0 };
    entry.total += (stock.changePercent || 0);
    entry.count += 1;
    extraMap.set(sector, entry);
  }
  for (const [name, v] of extraMap.entries()) {
    const existing = result.find(r => r.name === name);
    if (existing) {
      // Merge into existing sector
      existing.change = Math.round(((existing.change * existing.count + v.total) / (existing.count + v.count)) * 100) / 100;
      existing.count += v.count;
    } else if (v.count >= 2) {
      result.push({ name, change: Math.round((v.total / v.count) * 100) / 100, count: v.count });
    }
  }

  return result.sort((a, b) => b.change - a.change);
}

function ShimmerTiles() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg p-2.5 text-center skeleton-shimmer bg-muted/20"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="h-3 w-16 bg-muted/40 rounded mx-auto mb-1.5" />
          <div className="h-4 w-12 bg-muted/40 rounded mx-auto mb-1" />
          <div className="h-2 w-10 bg-muted/30 rounded mx-auto" />
        </div>
      ))}
    </div>
  );
}

export function SectorHeatmap() {
  const { data: indexData, isLoading: indexLoading } = useAllIndices();
  const { data: fnoData } = useFnOStocks();
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  const nseSectors = useMemo(() => indexData?.sectors ?? [], [indexData]);
  const isLiveNSE = indexData?.isLive && nseSectors.length > 0;

  const tvSectors = useMemo(() => {
    if (nseSectors.length > 0) return [];
    const allStocks = fnoData?.allStocks ?? [];
    return aggregateStocksBySector(allStocks);
  }, [nseSectors, fnoData]);

  // Always sorted highest → lowest (bullish left, bearish right)
  const sectors = useMemo(() => {
    const raw = isLiveNSE ? nseSectors : tvSectors;
    return [...raw].sort((a: any, b: any) => b.change - a.change);
  }, [isLiveNSE, nseSectors, tvSectors]);

  const source = isLiveNSE ? "NSE" : tvSectors.length > 0 ? "TradingView" : "";

  // Build symbol → stock data lookup for fast drill-down
  const stockBySymbol = useMemo(() => {
    const allStocks = fnoData?.allStocks ?? [];
    const map = new Map<string, any>();
    for (const stock of allStocks) {
      if (stock.symbol) map.set(stock.symbol, stock);
    }
    return map;
  }, [fnoData]);

  const selectedStocks = useMemo(() => {
    if (!selectedSector) return [];
    const allStocks = fnoData?.allStocks ?? [];

    // 1. Use static sector map (most reliable)
    const staticSymbols = SECTOR_STOCKS[selectedSector] ?? [];
    const fromStatic = staticSymbols
      .map(sym => stockBySymbol.get(sym))
      .filter(Boolean);

    // 2. Also scan allStocks by normalised TV sector field to catch any extra stocks
    const fromTV = allStocks.filter(s => {
      const norm = TV_SECTOR_ALIAS[s.sector || ""] || s.sector || "";
      return norm === selectedSector && !staticSymbols.includes(s.symbol);
    });

    const merged = [...fromStatic, ...fromTV];
    return merged.sort((a, b) => b.changePercent - a.changePercent);
  }, [selectedSector, stockBySymbol, fnoData]);

  if (sectors.length === 0 && !indexLoading) {
    return (
      <Card className="hover:shadow-card-hover transition-all duration-300">
        <CardHeader className="pb-3 pt-4 px-5 bg-gradient-to-r from-primary/5 to-transparent">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.5)]" /> Sector Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <ShimmerTiles />
          <p className="text-center text-xs text-muted-foreground/60 mt-3">Sector data loads during market hours from NSE</p>
        </CardContent>
      </Card>
    );
  }

  const bestChange = sectors.length > 0 ? Math.max(...sectors.map((s: any) => s.change)) : 0;
  const worstChange = sectors.length > 0 ? Math.min(...sectors.map((s: any) => s.change)) : 0;

  return (
    <Card className="hover:shadow-card-hover transition-all duration-300">
      <CardHeader className="pb-3 pt-4 px-5 bg-gradient-to-r from-primary/5 to-transparent">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.5)]" /> Sector Performance
          {source && (
            <Badge variant="outline" className="text-xs h-5 px-2 border-bullish/30 text-bullish ml-auto">
              {source}
            </Badge>
          )}
          {indexLoading && <Loader2 className="h-4 w-4 animate-spin ml-auto text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4 space-y-3">
        {/* Sector tiles — sorted bullish left → bearish right */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {sectors.map((sector: any) => {
            const pos = sector.change >= 0;
            const intensity = Math.min(Math.abs(sector.change) / 3, 1);
            const isBest = sector.change === bestChange && bestChange > 0;
            const isWorst = sector.change === worstChange && worstChange < 0;
            const isSelected = selectedSector === sector.name;
            return (
              <div
                key={sector.name}
                onClick={() => setSelectedSector(isSelected ? null : sector.name)}
                className={`rounded-lg p-2.5 text-center transition-all duration-200 hover:scale-105 cursor-pointer border ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/40 scale-105"
                    : isBest ? "border-bullish/30 shadow-sm shadow-bullish/10"
                    : isWorst ? "border-bearish/30 shadow-sm shadow-bearish/10"
                    : "border-transparent hover:border-border/30"
                }`}
                style={{
                  backgroundColor: pos
                    ? `hsl(var(--bullish) / ${0.06 + intensity * 0.22})`
                    : `hsl(var(--bearish) / ${0.06 + intensity * 0.22})`,
                }}
                title={`${sector.name}: ${pos ? "+" : ""}${sector.change.toFixed(2)}% — click to see stocks`}
              >
                <p className="text-xs font-semibold truncate mb-1 text-foreground/90">{sector.name}</p>
                <p className={`text-base font-bold font-mono tracking-tight ${pos ? "text-bullish drop-shadow-[0_0_3px_rgba(0,255,100,0.3)]" : "text-bearish drop-shadow-[0_0_3px_rgba(255,50,50,0.3)]"}`}>
                  {pos ? "+" : ""}{sector.change.toFixed(2)}%
                </p>
                {sector.count && (
                  <p className="text-xs font-medium text-muted-foreground mt-1">{sector.count} stocks</p>
                )}
                {(isBest || isWorst) && (
                  <span className={`text-xs font-bold uppercase tracking-wider mt-1 inline-block ${isBest ? "text-bullish drop-shadow-sm" : "text-bearish drop-shadow-sm"}`}>
                    {isBest ? "★ BEST" : "★ WORST"}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Drill-down stock list */}
        {selectedSector && (
          <div className="rounded-lg border border-border/40 bg-accent/10 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-accent/20">
              <span className="text-sm font-semibold text-foreground">
                {selectedSector} — Top Movers
              </span>
              <button
                onClick={() => setSelectedSector(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedStocks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                Stock-level data not available for this sector
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-px bg-border/20">
                {selectedStocks.map((stock) => {
                  const up = stock.changePercent >= 0;
                  return (
                    <div
                      key={stock.symbol}
                      className="flex items-center justify-between px-3 py-2 bg-background/60 hover:bg-accent/30 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{stock.symbol}</p>
                        {stock.ltp > 0 && (
                          <p className="text-xs text-muted-foreground font-mono">₹{stock.ltp.toLocaleString("en-IN")}</p>
                        )}
                      </div>
                      <div className={`flex items-center gap-0.5 ml-2 shrink-0 ${up ? "text-bullish" : "text-bearish"}`}>
                        {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        <span className="text-xs font-bold font-mono">
                          {up ? "+" : ""}{stock.changePercent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
