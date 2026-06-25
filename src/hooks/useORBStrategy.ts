import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAllIndices, useFnOStocks } from "./useMarketData";
import {
  saveTrade, getAllTrades, deleteTrade as dbDeleteTrade,
  type StoredTrade,
} from "@/lib/localDatabase";
import type { FnOStockData } from "@/lib/marketApi";

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

// ── Comprehensive F&O sector → stock map (~220 unique NSE F&O stocks) ──
export const SECTOR_STOCKS: Record<string, string[]> = {
  Banking: [
    "HDFCBANK","ICICIBANK","AXISBANK","KOTAKBANK","INDUSINDBK","IDFCFIRSTB",
    "FEDERALBNK","BANDHANBNK","SBIN","BANKBARODA","PNB","CANBK",
    "RBLBANK","AUBANK","DCBBANK","CUB","KARURVYSYA","LAKSHVILAS",
  ],
  "PSU Bank": ["SBIN","BANKBARODA","PNB","CANBK","UNIONBANK","INDIANB","UCOBANK"],
  IT: [
    "TCS","INFY","HCLTECH","WIPRO","TECHM","LTIM","MPHASIS","COFORGE",
    "PERSISTENT","OFSS","LTTS","TATATECH","BIRLASOFT","KPITTECH","BSOFT",
    "INTELLECT","MASTEK","ZENSAR","ROUTE",
  ],
  FMCG: [
    "HINDUNILVR","ITC","NESTLEIND","BRITANNIA","DABUR","MARICO","COLPAL",
    "GODREJCP","VBL","TATACONSUM","EMAMILTD","RADICO","MCDOWELL-N",
    "UNITDSPR","PATANJALI","PGHH","JYOTHYLAB",
  ],
  Pharma: [
    "SUNPHARMA","DRREDDY","CIPLA","DIVISLAB","LUPIN","AUROPHARMA","BIOCON",
    "TORNTPHARM","ALKEM","GLENMARK","GRANULES","IPCALAB","SYNGENE",
    "ZYDUSLIFE","LALPATHLAB","AJANTPHARM","NATCOPHARM","LAURUSLABS","GLAND",
  ],
  Health: [
    "APOLLOHOSP","FORTIS","MAXHEALTH","METROPOLIS","VIJAYA","KIMS",
    "POLYMED","ASTER",
  ],
  Auto: [
    "MARUTI","TATAMOTORS","M&M","BAJAJ-AUTO","HEROMOTOCO","TVSMOTOR",
    "EICHERMOT","ESCORTS","ASHOKLEY","BALKRISIND","MRF","APOLLOTYRE",
    "MOTHERSON","BHARATFORG","CUMMINSIND","TIINDIA","UNOMINDA","SONACOMS",
    "ENDURANCE","MINDAIND","GABRIEL","SUPRAJIT",
  ],
  Metal: [
    "TATASTEEL","JSWSTEEL","HINDALCO","VEDL","SAIL","JINDALSTEL","NMDC",
    "NATIONALUM","HINDCOPPER","JSL","APLAPOLLO","RATNAMANI","WELSPUNLIV",
    "JSWHL","APL",
  ],
  Energy: [
    "ONGC","BPCL","IOC","GAIL","TATAPOWER","NTPC","POWERGRID","CESC",
    "RELIANCE","COALINDIA","OIL","PETRONET","SJVN","JSWENERGY","TORNTPOWER",
    "SUZLON","ADANIENT","NHPC","INDPOWER",
  ],
  "Gas Distribution": [
    "IGL","MGL","GSPL","GUJGASLTD","ATGL","AEGISLOG",
  ],
  Telecom: [
    "BHARTIARTL","INDUSTOWER","TATACOMM","HFCL",
  ],
  Cement: [
    "ULTRACEMCO","AMBUJACEM","ACC","GRASIM","DALBHARAT","JKCEMENT",
    "RAMCOCEM","NUVOCO","HEIDELBERG","JKPAPER",
  ],
  Chemicals: [
    "PIDILITIND","DEEPAKNTR","NAVINFLUOR","SRF","TATACHEM","CLEAN",
    "GNFC","GUJFLUORO","COROMANDEL","PIIND","FLUOROCHEM","AARTI",
    "BASF","FINEORG","SUDARSCHEM","VINDHYATEL",
  ],
  Insurance: [
    "HDFCLIFE","SBILIFE","ICICIGI","ICICIPRULI","STARHEALTH","MFSL",
    "NIACL","LICI",
  ],
  "Fin Svc": [
    "BAJFINANCE","BAJAJFINSV","SHRIRAMFIN","CHOLAFIN","MANAPPURAM",
    "MUTHOOTFIN","LICHSGFIN","RECLTD","PFC","SBICARD","L&TFH","M&MFIN",
    "ABCAPITAL","SUNDARMFIN","IIFL","MOTILALOFS","ANGELONE","NUVAMA",
    "CANFINHOME","AADHARHFC","SPANDANA","UJJIVAN",
  ],
  AMC: ["HDFCAMC","UTIAMC","NAUKRI"],
  Exchange: ["MCX","BSE","CDSL","CAMS","IEX"],
  Realty: [
    "DLF","GODREJPROP","OBEROIRLTY","PRESTIGE","PHOENIXLTD","BRIGADE",
    "MAHINDCIE","IBREALEST","SOBHA","KOLTEPATIL",
  ],
  Media: ["SUNTV","ZEEL","PVRINOX","NAZARA","NETWORK18"],
  Infra: [
    "LT","HAL","BEL","BHEL","SIEMENS","ABB","IRCTC","ADANIPORTS","CONCOR",
    "IRCON","NBCC","BEML","RVNL","RAILTEL","GMRINFRA","KNRCON","KEC",
    "ENGINERSIN","HG","PTC",
  ],
  Consumer: [
    "DIXON","CROMPTON","HAVELLS","VOLTAS","POLYCAB","TITAN","AMBER","TRENT",
    "ASIANPAINT","BERGEPAINT","KANSAINER","PAGEIND","BATA","RELAXO",
    "JUBLFOOD","DMART","GODREJIND","ABFRL","RAYMOND","TRIDENT",
    "WHIRLPOOL","SYMPHONY","BLUESTARCO","ORIENTELEC",
  ],
  Internet: [
    "ZOMATO","NAUKRI","INDIAMART","PAYTM","POLICYBZR","DELHIVERY",
    "STAR","CARTRADE","EASEMYTRIP",
  ],
  "Aviation & Hotels": ["INDIGO","INTERGLOBE","INDHOTEL","LEMONTREE"],
  Fertilizer: ["COROMANDEL","CHAMBAL","GNFC","FACT","NFL"],
};

// ── Types ──
export interface ORBCandle {
  time: number; // UTC unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ORBRange {
  high: number;
  low: number;
  midpoint: number;
  startTime: number;
  endTime: number;
}

export interface MomentumInfo {
  confirmed: boolean;
  slopeDeg: number;    // normalized degrees — tan(deg) = slope%/candle; 20°≈0.36%/candle, 30°≈0.58%/candle
  slopePct: number;    // raw % change of EMA 9 over last 3 candles
  ema9: number;        // current EMA 9 value at the signal candle
  priceAboveEMA: boolean;
}

export interface ORBSignal {
  type: "bullish" | "bearish";
  candle: ORBCandle;
  breakoutPrice: number;
  time: number;
  momentum: MomentumInfo;
}

export interface SectorStrength {
  name: string;
  avgChange: number;
  topStocks: StockData[];
  direction: "bullish" | "bearish";
}

export interface AdvanceDecline {
  advancing: number;
  declining: number;
  unchanged: number;
  total: number;
  ratio: number;          // advancing / declining (capped at 99 to avoid Infinity)
  breadth: "bullish" | "bearish" | "mixed";
}

export interface StockData {
  symbol: string;
  ltp: number;
  changePercent: number;
  sector: string;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  sector: string;
  direction: "bullish" | "bearish";
  optionType: "CE" | "PE";
  atmStrike: number;
  entryStockPrice: number;
  entryTime: number;
  orbHigh: number;
  orbLow: number;
  initialSL: number;         // ORB low for bullish / ORB high for bearish (structural stop)
  slPrice: number;            // current SL: starts at initialSL, moves to entry at 1:1, trails EMA9 after 1:3
  risk: number;               // |entry - initialSL| per share
  target1: number;            // entry ± 1×risk → SL moves to entry
  target2: number;            // entry ± 2×risk → book 50%
  shares: number;             // floor(30000 / entry)
  slMovedToCost: boolean;
  partialBooked: boolean;
  partialExitPrice: number | null;
  partialExitTime: number | null;
  breakoutCandle: ORBCandle;
  exitTime: number | null;
  exitStockPrice: number | null;
  status: "OPEN" | "SL_HIT" | "COST_HIT" | "TARGET_HIT" | "MANUAL_EXIT";
  estimatedPremium: number;
  currentStockPrice: number;
  lotSize: number;
  reentryCount: number;
}

// Compute P&L for a paper trade. Accounts for 50% partial exit at 1:3 if booked.
export function computePaperTradePnL(trade: PaperTrade): number {
  const shares = trade.shares ?? sharesFor30K(trade.entryStockPrice);
  const halfShares = Math.floor(shares / 2);
  const remainShares = shares - halfShares;
  const exitPx = trade.exitStockPrice ?? trade.currentStockPrice;
  const dir = trade.direction === "bullish" ? 1 : -1;

  if (trade.partialBooked && trade.partialExitPrice != null) {
    const partialPnL = dir * (trade.partialExitPrice - trade.entryStockPrice) * halfShares;
    const remainPnL = dir * (exitPx - trade.entryStockPrice) * remainShares;
    return partialPnL + remainPnL;
  }
  return dir * (exitPx - trade.entryStockPrice) * shares;
}

// Shares for ₹30K capital at a given entry price
export function sharesFor30K(entryPrice: number): number {
  return Math.max(1, Math.floor(30_000 / entryPrice));
}
// Backward-compat alias
export const sharesFor20K = sharesFor30K;

// ── Helpers ──

// IST ORB window: 9:15–9:30 AM IST = 3:45–4:00 AM UTC
function isInORBWindow(utcTs: number): boolean {
  const d = new Date(utcTs * 1000);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return utcMin >= 225 && utcMin < 240; // 3:45 AM = 225, 4:00 AM = 240
}

function isAfterORB(utcTs: number): boolean {
  const d = new Date(utcTs * 1000);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  // After 9:30 IST (4:00 AM UTC) and before 3:30 PM IST (10:00 AM UTC)
  return utcMin >= 240 && utcMin < 600;
}

function isTradingHour(utcTs: number): boolean {
  const d = new Date(utcTs * 1000);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return utcMin >= 225 && utcMin < 600;
}

export function getATMStrike(price: number): number {
  if (price < 200) return Math.round(price / 2.5) * 2.5;
  if (price < 500) return Math.round(price / 5) * 5;
  if (price < 2000) return Math.round(price / 10) * 10;
  if (price < 5000) return Math.round(price / 50) * 50;
  return Math.round(price / 100) * 100;
}

export function getLotSize(price: number): number {
  if (price > 5000) return 25;
  if (price > 2000) return 50;
  if (price > 1000) return 75;
  if (price > 500) return 150;
  return 400;
}

function todayDateString(): string {
  // Keep using UTC for date strings (IST and UTC have the same calendar date during market hours)
  return new Date().toISOString().slice(0, 10);
}

function getISTTotalMinutes(): number {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // UTC+5:30
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

// ── Intraday candle fetcher ──
function parseCandleResponse(d: any): ORBCandle[] {
  const timestamps: number[] = d?.timestamp || d?.start_Time || [];
  const opens: number[]  = d?.open  || [];
  const highs: number[]  = d?.high  || [];
  const lows: number[]   = d?.low   || [];
  const closes: number[] = d?.close || [];
  const volumes: number[] = d?.volume || [];
  return timestamps
    .map((t, i) => ({
      time: t,
      open:   opens[i]   ?? 0,
      high:   highs[i]   ?? 0,
      low:    lows[i]    ?? 0,
      close:  closes[i]  ?? 0,
      volume: volumes[i] ?? 0,
    }))
    .filter(c => isTradingHour(c.time) && c.close > 0);
}

export async function fetchIntradayCandles(symbol: string, date?: string): Promise<ORBCandle[]> {
  const targetDate = date ?? todayDateString();

  // Primary: Yahoo Finance (free, no auth)
  try {
    const params = new URLSearchParams({ symbol, interval: "5", fromDate: targetDate, toDate: targetDate });
    const res = await fetch(`${PROXY_BASE}/api/yahoo-chart?${params}`);
    if (res.ok) {
      const json = await res.json();
      const candles = parseCandleResponse(json?.data || json);
      if (candles.length >= 5) return candles;  // need at least ORB window + 1 post-ORB candle
    }
  } catch { /* fall through */ }

  // Fallback: Dhan historical candles (authenticated, covers all NSE_EQ stocks)
  try {
    const activeBroker = (() => {
      try { return JSON.parse(localStorage.getItem("activeBroker") || "null"); } catch { return null; }
    })();
    const headers: Record<string, string> = {};
    if (activeBroker?.brokerId === "dhan" && activeBroker.values?.clientId) {
      headers["x-dhan-client-id"]    = activeBroker.values.clientId;
      headers["x-dhan-access-token"] = activeBroker.values.accessToken;
    }
    const params = new URLSearchParams({
      endpoint: "historical",
      symbol,
      exchangeSegment: "NSE_EQ",
      instrument: "EQUITY",
      interval: "5",
      fromDate: targetDate,
      toDate:   targetDate,
    });
    const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?${params}`, { headers });
    if (res.ok) {
      const json = await res.json();
      const d = json?.data || json;
      const candles = parseCandleResponse(d);
      if (candles.length >= 5) return candles;
    }
  } catch { /* fall through */ }

  return [];
}

export function useIntradayCandles(symbol: string, enabled = true, date?: string) {
  return useQuery({
    queryKey: ["orb-intraday", symbol, date ?? "today"],
    queryFn: () => fetchIntradayCandles(symbol, date),
    enabled,
    // Historical dates: no auto-refresh; today: poll every 30s
    refetchInterval: (!date || date === todayDateString()) ? 30_000 : false,
    staleTime: (!date || date === todayDateString()) ? 15_000 : Infinity,
  });
}

// ── EMA & Momentum ───────────────────────────────────────────────────────

// Minimum normalized slope degrees to confirm momentum.
// Normalized scale: tan(deg) = slope_%_per_candle.
//   20° → ~0.36%/candle → EMA 9 moves ≥0.36% every 5 minutes (solid trend)
//   30° → ~0.58%/candle → strong trend
const MIN_MOMENTUM_SLOPE_DEG = 20;
const EMA_SLOPE_LOOKBACK = 3; // candles

/**
 * Compute EMA for a given period over candle closes.
 * Seeds with SMA of the first `period` candles, then applies EMA multiplier.
 * Returns an array aligned 1-to-1 with `candles`.
 */
export function computeEMA(candles: ORBCandle[], period: number): number[] {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = new Array(candles.length).fill(0);
  // Seed: SMA of first min(period, length) candles
  const seedLen = Math.min(period, candles.length);
  let seed = candles.slice(0, seedLen).reduce((s, c) => s + c.close, 0) / seedLen;
  for (let i = 0; i < candles.length; i++) {
    seed = i < seedLen ? seed : candles[i].close * k + seed * (1 - k);
    result[i] = seed;
  }
  return result;
}

/**
 * Check momentum at candle index `idx`.
 *
 * Bullish momentum: EMA 9 has a positive slope ≥ MIN_MOMENTUM_SLOPE_DEG
 *                   AND the breakout candle closes above EMA 9.
 * Bearish momentum: EMA 9 slope ≤ -MIN_MOMENTUM_SLOPE_DEG
 *                   AND the breakout candle closes below EMA 9.
 */
export function checkMomentum(
  candles: ORBCandle[],
  idx: number,
  direction: "bullish" | "bearish",
  emas9: number[],
  minDeg = MIN_MOMENTUM_SLOPE_DEG
): MomentumInfo {
  const ema9 = emas9[idx] ?? 0;
  const prevIdx = Math.max(0, idx - EMA_SLOPE_LOOKBACK);
  const prevEma = emas9[prevIdx] ?? ema9;
  // % change of EMA over the lookback window
  const slopePct = prevEma > 0 ? ((ema9 - prevEma) / prevEma) * 100 : 0;
  const slopePctPerCandle = slopePct / Math.max(1, idx - prevIdx);
  // Normalized degrees: atan(slope_%_per_candle) in degrees
  const slopeDeg = Math.atan(slopePctPerCandle) * (180 / Math.PI);
  const price = candles[idx]?.close ?? 0;
  const priceAboveEMA = price > ema9;

  const confirmed =
    direction === "bullish"
      ? slopeDeg >= minDeg && priceAboveEMA
      : slopeDeg <= -minDeg && !priceAboveEMA;

  return { confirmed, slopeDeg, slopePct, ema9, priceAboveEMA };
}

// Compute ORB range from candle array
export function computeORB(candles: ORBCandle[]): ORBRange | null {
  const orb = candles.filter(c => isInORBWindow(c.time));
  if (orb.length === 0) return null;
  const high = Math.max(...orb.map(c => c.high));
  const low = Math.min(...orb.map(c => c.low));
  return {
    high,
    low,
    midpoint: (high + low) / 2,
    startTime: orb[0].time,
    endTime: orb[orb.length - 1].time + 300, // +5 min (end of last ORB candle)
  };
}

// Detect first ORB breakout signal from post-ORB candles (no EMA gate)
export function detectSignal(candles: ORBCandle[], orb: ORBRange): ORBSignal | null {
  const emas9 = computeEMA(candles, 9);
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!isAfterORB(candle.time)) continue;
    if (candle.close > orb.high && candle.open < candle.close) {
      const momentum = checkMomentum(candles, i, "bullish", emas9);
      return { type: "bullish", candle, breakoutPrice: orb.high, time: candle.time, momentum };
    }
    if (candle.close < orb.low && candle.open > candle.close) {
      const momentum = checkMomentum(candles, i, "bearish", emas9);
      return { type: "bearish", candle, breakoutPrice: orb.low, time: candle.time, momentum };
    }
  }
  return null;
}

export interface ORBEvent {
  kind: "entry" | "sl_hit" | "reentry" | "target_1x" | "target_2x";
  signal: ORBSignal;
  reentryCount: number;
  entryMeta?: { entryPrice: number; initialSL: number; risk: number; target1: number; target2: number; };
}

/**
 * Walk the full post-ORB candle sequence and emit every trade lifecycle event.
 *
 * Entry rules: 5-min candle close > ORB high (green candle) for bullish; vice versa bearish.
 * SL: if ORB range > 1% → 1.3% from entry; else ORB low/high.
 * 1:1 reached → move SL to entry. 1:3 reached → book 50%. After 1:3 → trail EMA9.
 */
const MAX_REENTRIES = 1; // max re-entries after first SL hit

export function detectAllEvents(candles: ORBCandle[], orb: ORBRange): ORBEvent[] {
  const emas9 = computeEMA(candles, 9);
  const events: ORBEvent[] = [];

  type Phase = "watching" | "in_bullish" | "in_bearish" | "sl_hit_bullish" | "sl_hit_bearish" | "done";
  let phase: Phase = "watching";
  let reentryCount = 0;
  let entryPrice = 0, initialSL = 0, risk = 0, target1 = 0, target2 = 0, currentSL = 0;
  let slMovedToCost = false, partialBooked = false;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!isAfterORB(candle.time)) continue;
    if (phase === "done") break;
    const ema9 = emas9[i] ?? 0;

    switch (phase) {
      case "watching": {
        // First breakout — either direction is valid
        if (candle.close > orb.high && candle.open < candle.close && (ema9 === 0 || candle.close >= ema9 * 0.999)) {
          const momentum = checkMomentum(candles, i, "bullish", emas9);
          entryPrice = orb.high; initialSL = orb.low;
          risk = entryPrice - initialSL;
          target1 = entryPrice + risk; target2 = entryPrice + 2 * risk;
          currentSL = initialSL; slMovedToCost = false; partialBooked = false;
          events.push({ kind: "entry", signal: { type: "bullish", candle, breakoutPrice: orb.high, time: candle.time, momentum }, reentryCount, entryMeta: { entryPrice, initialSL, risk, target1, target2 } });
          phase = "in_bullish";
        } else if (candle.close < orb.low && candle.open > candle.close && (ema9 === 0 || candle.close <= ema9 * 1.001)) {
          const momentum = checkMomentum(candles, i, "bearish", emas9);
          entryPrice = orb.low; initialSL = orb.high;
          risk = initialSL - entryPrice;
          target1 = entryPrice - risk; target2 = entryPrice - 2 * risk;
          currentSL = initialSL; slMovedToCost = false; partialBooked = false;
          events.push({ kind: "entry", signal: { type: "bearish", candle, breakoutPrice: orb.low, time: candle.time, momentum }, reentryCount, entryMeta: { entryPrice, initialSL, risk, target1, target2 } });
          phase = "in_bearish";
        }
        break;
      }
      case "sl_hit_bullish": {
        if (candle.close > orb.high && candle.open < candle.close && (ema9 === 0 || candle.close >= ema9 * 0.999)) {
          const momentum = checkMomentum(candles, i, "bullish", emas9);
          entryPrice = orb.high; initialSL = orb.low;
          risk = entryPrice - initialSL;
          target1 = entryPrice + risk; target2 = entryPrice + 2 * risk;
          currentSL = initialSL; slMovedToCost = false; partialBooked = false;
          reentryCount++;
          events.push({ kind: "reentry", signal: { type: "bullish", candle, breakoutPrice: orb.high, time: candle.time, momentum }, reentryCount, entryMeta: { entryPrice, initialSL, risk, target1, target2 } });
          phase = "in_bullish";
        }
        break;
      }
      case "sl_hit_bearish": {
        if (candle.close < orb.low && candle.open > candle.close && (ema9 === 0 || candle.close <= ema9 * 1.001)) {
          const momentum = checkMomentum(candles, i, "bearish", emas9);
          entryPrice = orb.low; initialSL = orb.high;
          risk = initialSL - entryPrice;
          target1 = entryPrice - risk; target2 = entryPrice - 2 * risk;
          currentSL = initialSL; slMovedToCost = false; partialBooked = false;
          reentryCount++;
          events.push({ kind: "reentry", signal: { type: "bearish", candle, breakoutPrice: orb.low, time: candle.time, momentum }, reentryCount, entryMeta: { entryPrice, initialSL, risk, target1, target2 } });
          phase = "in_bearish";
        }
        break;
      }
      case "in_bullish": {
        // Trail SL up on EMA9 once cost-to-cost is active
        if (slMovedToCost && ema9 > currentSL) currentSL = ema9;
        // SL hit: close below currentSL with 0.1% buffer
        if (candle.close < currentSL * 0.999) {
          const s: ORBSignal = { type: "bearish", candle, breakoutPrice: currentSL, time: candle.time, momentum: checkMomentum(candles, i, "bearish", emas9) };
          events.push({ kind: "sl_hit", signal: s, reentryCount });
          phase = reentryCount >= MAX_REENTRIES ? "done" : "sl_hit_bullish";
          break;
        }
        // T1: hit 1:1 → SL to entry (cost)
        if (!slMovedToCost && candle.high >= target1) {
          const s: ORBSignal = { type: "bullish", candle, breakoutPrice: target1, time: candle.time, momentum: checkMomentum(candles, i, "bullish", emas9) };
          events.push({ kind: "target_1x", signal: s, reentryCount });
          slMovedToCost = true; currentSL = entryPrice;
        }
        // T2: hit 2R → book 50%, EMA9 trailing begins
        if (!partialBooked && candle.high >= target2) {
          const s: ORBSignal = { type: "bullish", candle, breakoutPrice: target2, time: candle.time, momentum: checkMomentum(candles, i, "bullish", emas9) };
          events.push({ kind: "target_2x", signal: s, reentryCount });
          partialBooked = true;
        }
        break;
      }
      case "in_bearish": {
        if (slMovedToCost && ema9 > 0 && ema9 < currentSL) currentSL = ema9;
        if (candle.close > currentSL * 1.001) {
          const s: ORBSignal = { type: "bullish", candle, breakoutPrice: currentSL, time: candle.time, momentum: checkMomentum(candles, i, "bullish", emas9) };
          events.push({ kind: "sl_hit", signal: s, reentryCount });
          phase = reentryCount >= MAX_REENTRIES ? "done" : "sl_hit_bearish";
          break;
        }
        if (!slMovedToCost && candle.low <= target1) {
          const s: ORBSignal = { type: "bearish", candle, breakoutPrice: target1, time: candle.time, momentum: checkMomentum(candles, i, "bearish", emas9) };
          events.push({ kind: "target_1x", signal: s, reentryCount });
          slMovedToCost = true; currentSL = entryPrice;
        }
        if (!partialBooked && candle.low <= target2) {
          const s: ORBSignal = { type: "bearish", candle, breakoutPrice: target2, time: candle.time, momentum: checkMomentum(candles, i, "bearish", emas9) };
          events.push({ kind: "target_2x", signal: s, reentryCount });
          partialBooked = true;
        }
        break;
      }
    }
  }

  return events;
}

/** Returns the latest pending re-entry signal (after last SL) if one exists but hasn't been entered yet. */
export function detectReentrySignal(candles: ORBCandle[], orb: ORBRange, lastTradeTime: number): ORBSignal | null {
  const events = detectAllEvents(candles, orb);
  // Find the latest reentry event that occurred after the last trade entry time
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if ((ev.kind === "reentry" || ev.kind === "entry") && ev.signal.time > lastTradeTime / 1000) {
      return ev.signal;
    }
  }
  return null;
}

// ── Convert PaperTrade ↔ StoredTrade ──
export function toStoredTrade(t: PaperTrade, finalPnL: number | null = null): StoredTrade {
  const d = new Date(t.entryTime);
  return {
    id: t.id,
    strategy: "ORB",
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    symbol: t.symbol, sector: t.sector, direction: t.direction,
    optionType: t.optionType, atmStrike: t.atmStrike, lotSize: t.lotSize,
    entryStockPrice: t.entryStockPrice, entryTime: t.entryTime,
    exitStockPrice: t.exitStockPrice, exitTime: t.exitTime,
    slPrice: t.slPrice, orbHigh: t.orbHigh, orbLow: t.orbLow,
    reentryCount: t.reentryCount, status: t.status,
    estimatedPremium: t.estimatedPremium, finalPnL,
    initialSL: t.initialSL, risk: t.risk, target1: t.target1, target2: t.target2,
    slMovedToCost: t.slMovedToCost, partialBooked: t.partialBooked,
    partialExitPrice: t.partialExitPrice, partialExitTime: t.partialExitTime,
    shares: t.shares,
  };
}

export function fromStoredTrade(s: StoredTrade): PaperTrade {
  const entry = s.entryStockPrice;
  const orbRangePct = s.orbHigh > 0 ? (s.orbHigh - s.orbLow) / s.orbHigh : 0;
  const initialSL = s.initialSL ?? (s.direction === "bullish"
    ? (orbRangePct > 0.01 ? entry * (1 - 0.013) : s.orbLow)
    : (orbRangePct > 0.01 ? entry * (1 + 0.013) : s.orbHigh));
  const risk = s.risk ?? Math.abs(entry - initialSL);
  return {
    id: s.id, symbol: s.symbol, sector: s.sector, direction: s.direction,
    optionType: s.optionType, atmStrike: s.atmStrike, lotSize: s.lotSize,
    entryStockPrice: entry, entryTime: s.entryTime,
    exitStockPrice: s.exitStockPrice, exitTime: s.exitTime,
    slPrice: s.slPrice, orbHigh: s.orbHigh, orbLow: s.orbLow,
    reentryCount: s.reentryCount, status: s.status,
    estimatedPremium: s.estimatedPremium,
    currentStockPrice: s.exitStockPrice ?? entry,
    breakoutCandle: { time: s.entryTime / 1000, open: entry, high: entry, low: entry, close: entry, volume: 0 },
    initialSL,
    risk,
    target1: s.target1 ?? (s.direction === "bullish" ? entry + risk : entry - risk),
    target2: s.target2 ?? (s.direction === "bullish" ? entry + 2 * risk : entry - 2 * risk),
    shares: s.shares ?? sharesFor30K(entry),
    slMovedToCost: s.slMovedToCost ?? false,
    partialBooked: s.partialBooked ?? false,
    partialExitPrice: s.partialExitPrice ?? null,
    partialExitTime: s.partialExitTime ?? null,
  };
}

// ── Liquidity thresholds ──
// Stock must meet EITHER price + volume OR price + OI to be considered liquid enough for ORB options.
// Purpose: filter out cheap or thinly-traded scrips where ATM option bid-ask spreads are too wide.
const MIN_STOCK_PRICE = 100;      // ₹100 minimum — options on sub-₹100 stocks are untradeably thin
const MIN_VOLUME = 100_000;       // 1 lakh shares/day minimum equity volume
const MIN_OI = 50_000;            // 50k contracts minimum F&O open interest

function isLiquidForOptions(s: { ltp: number; volume?: number; openInterest?: number }): boolean {
  if (s.ltp < MIN_STOCK_PRICE) return false;
  const vol = s.volume ?? 0;
  const oi = s.openInterest ?? 0;
  // If both volume and OI are provided and both are too low, skip
  if (vol > 0 && oi > 0 && vol < MIN_VOLUME && oi < MIN_OI) return false;
  // If only volume is provided (OI not available), apply volume floor
  if (vol > 0 && oi === 0 && vol < MIN_VOLUME) return false;
  return true;
}

// ── 9:30 AM snapshot ──
interface DaySnapshot930 {
  stocks: FnOStockData[];
  capturedAt: number;
  istDate: string;
}

function snap930Key(type: "base" | "active", date: string) {
  return `orb-930-${type}-${date}`;
}
function loadSnap930(type: "base" | "active", date: string): DaySnapshot930 | null {
  try { const r = localStorage.getItem(snap930Key(type, date)); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function saveSnap930(type: "base" | "active", date: string, snap: DaySnapshot930) {
  try { localStorage.setItem(snap930Key(type, date), JSON.stringify(snap)); } catch { /* ignore */ }
}

// ── Main hook ──
export function useORBStrategy() {
  const { data: allIndices } = useAllIndices();
  const { data: fnoData, isLoading: isFnOLoading } = useFnOStocks();
  const qc = useQueryClient();
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const userSelectedRef = useRef(false);

  // Load trades from IndexedDB
  const { data: storedTrades = [] } = useQuery({
    queryKey: ["orb-paper-trades"],
    queryFn: getAllTrades,
    staleTime: Infinity,
  });

  // Derive PaperTrade[] from StoredTrade[] for backward compat with the UI
  const paperTrades = useMemo(() => storedTrades.map(fromStoredTrade), [storedTrades]);

  // ── NIFTY market bias ──
  const niftySector = allIndices?.sectors?.find((s: any) => s.name === "Banking" || s.fullName === "NIFTY BANK") ?? null;
  const niftyData = allIndices?.sectors;
  const vix = allIndices?.vix;

  // Get NIFTY change from FnO or indices
  const niftyStock = fnoData?.allStocks?.find(s => s.symbol === "NIFTY") ?? null;

  // NIFTY 500 proxy bias: A/D ratio AND avg change must BOTH confirm direction
  const niftyBias = useMemo(() => {
    const stocks = fnoData?.allStocks ?? [];
    if (stocks.length < 10) return "neutral";
    const advancing = stocks.filter(s => s.changePercent > 0.1).length;
    const declining = stocks.filter(s => s.changePercent < -0.1).length;
    const ratio = declining > 0 ? advancing / declining : advancing > 0 ? 99 : 1;
    const avgChange = stocks.reduce((s, x) => s + x.changePercent, 0) / stocks.length;
    if (ratio >= 1.5 && avgChange > 0.3) return "bullish";
    if (ratio <= 0.67 && avgChange < -0.3) return "bearish";
    return "neutral";
  }, [fnoData]);

  // ── Advance-Decline breadth from all F&O stocks ──
  const advanceDecline = useMemo((): AdvanceDecline => {
    const stocks = fnoData?.allStocks ?? [];
    const advancing = stocks.filter(s => s.changePercent > 0).length;
    const declining = stocks.filter(s => s.changePercent < 0).length;
    const unchanged = stocks.length - advancing - declining;
    const ratio = declining > 0 ? advancing / declining : advancing > 0 ? 99 : 1;
    const breadth: AdvanceDecline["breadth"] =
      ratio >= 1.3 ? "bullish" : ratio <= 0.77 ? "bearish" : "mixed";
    return { advancing, declining, unchanged, total: stocks.length, ratio: Math.min(ratio, 99), breadth };
  }, [fnoData]);

  // ── Sector strength ──
  const sectorStrengths = useMemo((): SectorStrength[] => {
    const allStocks = fnoData?.allStocks ?? [];
    const symbolMap = new Map<string, StockData>();
    for (const s of allStocks) {
      if (!s.symbol || s.ltp <= 0) continue;
      // Liquidity gate: skip cheap scrips and thinly-traded options
      if (!isLiquidForOptions({ ltp: s.ltp, volume: s.volume, openInterest: s.openInterest })) continue;
      symbolMap.set(s.symbol, { symbol: s.symbol, ltp: s.ltp, changePercent: s.changePercent, sector: s.sector ?? "" });
    }

    return Object.entries(SECTOR_STOCKS)
      .map(([sectorName, symbols]) => {
        const stocks = symbols.map(sym => symbolMap.get(sym)).filter(Boolean) as StockData[];
        if (stocks.length < 2) return null;
        const avg = stocks.reduce((s, x) => s + x.changePercent, 0) / stocks.length;
        const direction: SectorStrength["direction"] = avg >= 0 ? "bullish" : "bearish";
        // Sort topStocks by the sector's own direction — bearish sectors pick most-declining stocks
        const topStocks = [...stocks]
          .sort((a, b) => direction === "bearish"
            ? a.changePercent - b.changePercent   // most negative first
            : b.changePercent - a.changePercent   // most positive first
          )
          .slice(0, 6);
        return { name: sectorName, avgChange: Math.round(avg * 100) / 100, topStocks, direction };
      })
      .filter(Boolean)
      // Sort overall list descending by avgChange so bullish sectors appear first
      .sort((a, b) => b!.avgChange - a!.avgChange) as SectorStrength[];
  }, [fnoData]);

  const [snapshotData, setSnapshotData] = useState<DaySnapshot930 | null>(() =>
    loadSnap930("active", todayDateString()) ?? loadSnap930("base", todayDateString())
  );
  const [isActiveOverridden, setIsActiveOverridden] = useState<boolean>(() => {
    const d = todayDateString();
    return !!loadSnap930("active", d) && !!loadSnap930("base", d);
  });

  // Stocks for ORB computation: snapshot when available, else live data
  const orbStocks = useMemo(() =>
    snapshotData?.stocks ?? fnoData?.allStocks ?? [],
  [snapshotData, fnoData]);

  // ORB bias (from snapshot)
  const orbBias = useMemo((): "bullish" | "bearish" | "neutral" => {
    const stocks = orbStocks;
    if (stocks.length < 10) return "neutral";
    const advancing = stocks.filter(s => s.changePercent > 0.1).length;
    const declining = stocks.filter(s => s.changePercent < -0.1).length;
    const ratio = declining > 0 ? advancing / declining : advancing > 0 ? 99 : 1;
    const avg = stocks.reduce((s, x) => s + x.changePercent, 0) / stocks.length;
    if (ratio >= 1.5 && avg > 0.3) return "bullish";
    if (ratio <= 0.67 && avg < -0.3) return "bearish";
    return "neutral";
  }, [orbStocks]);

  // ORB sector strengths (from snapshot)
  const orbSectorStrengths = useMemo((): SectorStrength[] => {
    const symbolMap = new Map<string, StockData>();
    for (const s of orbStocks) {
      if (!s.symbol || s.ltp <= 0) continue;
      if (!isLiquidForOptions({ ltp: s.ltp, volume: s.volume, openInterest: s.openInterest })) continue;
      symbolMap.set(s.symbol, { symbol: s.symbol, ltp: s.ltp, changePercent: s.changePercent, sector: s.sector ?? "" });
    }
    return Object.entries(SECTOR_STOCKS).map(([sectorName, symbols]) => {
      const stocks = symbols.map(sym => symbolMap.get(sym)).filter(Boolean) as StockData[];
      if (stocks.length < 2) return null;
      const avg = stocks.reduce((s, x) => s + x.changePercent, 0) / stocks.length;
      const direction: SectorStrength["direction"] = avg >= 0 ? "bullish" : "bearish";
      const topStocks = [...stocks]
        .sort((a, b) => direction === "bearish" ? a.changePercent - b.changePercent : b.changePercent - a.changePercent)
        .slice(0, 6);
      return { name: sectorName, avgChange: Math.round(avg * 100) / 100, topStocks, direction };
    }).filter(Boolean).sort((a, b) => b!.avgChange - a!.avgChange) as SectorStrength[];
  }, [orbStocks]);

  // ORB active sectors (from snapshot)
  const orbActiveSectors = useMemo(() => {
    if (orbBias === "bullish") return orbSectorStrengths.filter(s => s.avgChange > 1).slice(0, 5);
    if (orbBias === "bearish") return orbSectorStrengths.filter(s => s.avgChange < -1)
      .sort((a, b) => a.avgChange - b.avgChange).slice(0, 5);
    const bull = orbSectorStrengths.filter(s => s.avgChange > 1).slice(0, 3);
    const bear = orbSectorStrengths.filter(s => s.avgChange < -1)
      .sort((a, b) => a.avgChange - b.avgChange).slice(0, 3);
    return [...bull, ...bear];
  }, [orbSectorStrengths, orbBias]);

  // ORB watchlist (from snapshot)
  const orbWatchlist = useMemo((): StockData[] => {
    const seen = new Set<string>();
    const list: StockData[] = [];
    for (const sec of orbActiveSectors) {
      const isBull = sec.direction === "bullish";
      const strong = sec.topStocks.filter(s => isBull ? s.changePercent > 2 : s.changePercent < -2);
      for (const stock of strong) {
        if (!seen.has(stock.symbol)) { seen.add(stock.symbol); list.push({ ...stock, sector: sec.name }); }
      }
    }
    return list;
  }, [orbActiveSectors]);

  // Auto-take 9:30 AM snapshot when IST >= 9:25 AM and no base snapshot exists
  const autoSnappedRef = useRef(false);
  useEffect(() => {
    if (autoSnappedRef.current) return;
    const stocks = fnoData?.allStocks ?? [];
    if (stocks.length < 10) return;
    const today = todayDateString();
    if (loadSnap930("base", today)) { autoSnappedRef.current = true; return; } // already have base
    const istMins = getISTTotalMinutes();
    if (istMins < 9 * 60 + 25) return; // before 9:25 AM IST
    autoSnappedRef.current = true;
    const snap: DaySnapshot930 = { stocks, capturedAt: Date.now(), istDate: today };
    saveSnap930("base", today, snap);
    saveSnap930("active", today, snap);
    setSnapshotData(snap);
    setIsActiveOverridden(false);
  }, [fnoData]);

  // Auto-select the first watchlist stock once it's available.
  useEffect(() => {
    if (userSelectedRef.current) return;
    if (orbWatchlist.length > 0) {
      setSelectedSymbol(orbWatchlist[0].symbol);
    }
  }, [orbWatchlist]);

  // Expose a wrapped setter that marks the selection as user-driven
  const selectSymbol = useCallback((sym: string) => {
    userSelectedRef.current = true;
    setSelectedSymbol(sym);
  }, []);

  const takeSnapshot = useCallback(() => {
    const stocks = fnoData?.allStocks ?? [];
    if (stocks.length < 10) return;
    const today = todayDateString();
    const snap: DaySnapshot930 = { stocks, capturedAt: Date.now(), istDate: today };
    if (!loadSnap930("base", today)) {
      saveSnap930("base", today, snap);
      setIsActiveOverridden(false);
    } else {
      setIsActiveOverridden(true);
    }
    saveSnap930("active", today, snap);
    setSnapshotData(snap);
  }, [fnoData]);

  const restoreBaseSnapshot = useCallback(() => {
    const today = todayDateString();
    const base = loadSnap930("base", today);
    if (!base) return;
    saveSnap930("active", today, base);
    setSnapshotData(base);
    setIsActiveOverridden(false);
  }, []);

  // ── Paper trade management (IndexedDB-backed) ──
  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ["orb-paper-trades"] }), [qc]);

  const addPaperTrade = useCallback(async (
    symbol: string,
    sector: string,
    signal: ORBSignal,
    orb: ORBRange,
    currentPrice: number,
    reentryCount = 0
  ) => {
    // Max 10 trades per day
    const todayStr = todayDateString();
    const todayCount = storedTrades.filter(t => t.date === todayStr).length;
    if (todayCount >= 10) return;

    // Entry at ORB breakout level (not current price / candle close)
    const entryPrice = signal.type === "bullish" ? orb.high : orb.low;
    // SL always at structural ORB boundary — ORB Low for bullish, ORB High for bearish
    const initialSL = signal.type === "bullish" ? orb.low : orb.high;
    const risk = Math.abs(entryPrice - initialSL);
    const target1 = signal.type === "bullish" ? entryPrice + risk : entryPrice - risk;
    const target2 = signal.type === "bullish" ? entryPrice + 2 * risk : entryPrice - 2 * risk;
    const shares = sharesFor30K(entryPrice);
    const atmStrike = getATMStrike(entryPrice);

    const trade: PaperTrade = {
      id: `${symbol}-${Date.now()}`,
      symbol, sector,
      direction: signal.type,
      optionType: signal.type === "bullish" ? "CE" : "PE",
      atmStrike,
      entryStockPrice: entryPrice,
      entryTime: Date.now(),
      orbHigh: orb.high,
      orbLow: orb.low,
      initialSL, slPrice: initialSL, risk, target1, target2, shares,
      slMovedToCost: false, partialBooked: false,
      partialExitPrice: null, partialExitTime: null,
      breakoutCandle: signal.candle,
      exitTime: null, exitStockPrice: null, status: "OPEN",
      estimatedPremium: atmStrike * 0.02,
      currentStockPrice: entryPrice,
      lotSize: getLotSize(entryPrice),
      reentryCount,
    };
    await saveTrade(toStoredTrade(trade, null));
    invalidate();
  }, [storedTrades, invalidate]);

  const exitTrade = useCallback(async (id: string, exitPrice: number, reason: PaperTrade["status"] = "MANUAL_EXIT") => {
    const trade = paperTrades.find(t => t.id === id);
    if (!trade) return;
    const updated: PaperTrade = { ...trade, status: reason, exitTime: Date.now(), exitStockPrice: exitPrice, currentStockPrice: exitPrice };
    const pnl = computePaperTradePnL(updated);
    await saveTrade(toStoredTrade(updated, pnl));
    invalidate();
  }, [paperTrades, invalidate]);

  const updateTradePrice = useCallback(async (id: string, currentPrice: number) => {
    const trade = paperTrades.find(t => t.id === id);
    if (!trade) return;
    await saveTrade(toStoredTrade({ ...trade, currentStockPrice: currentPrice }, null));
    invalidate();
  }, [paperTrades, invalidate]);

  const clearTrades = useCallback(async () => {
    await Promise.all(storedTrades.map(t => dbDeleteTrade(t.id)));
    invalidate();
  }, [storedTrades, invalidate]);

  const updateTrade = useCallback(async (id: string, updates: Partial<PaperTrade>) => {
    const trade = paperTrades.find(t => t.id === id);
    if (!trade) return;
    const updated = { ...trade, ...updates };
    const pnl = updated.status !== "OPEN" ? computePaperTradePnL(updated) : null;
    await saveTrade(toStoredTrade(updated, pnl));
    invalidate();
  }, [paperTrades, invalidate]);

  return {
    niftyBias,         // live — for sector rotation panel
    orbBias,           // snapshot-based — for ORB trades
    advanceDecline,
    vix,
    sectorStrengths,   // live — for sector rotation panel
    activeSectors: orbActiveSectors,  // snapshot-based
    watchlist: orbWatchlist,          // snapshot-based
    snapshotTime: snapshotData ? new Date(snapshotData.capturedAt) : null,
    hasSnapshot: !!snapshotData,
    isActiveOverridden,
    takeSnapshot,
    restoreBaseSnapshot,
    isLoadingData: isFnOLoading,
    selectedSymbol,
    setSelectedSymbol: selectSymbol,
    paperTrades,
    addPaperTrade,
    updateTradePrice,
    exitTrade,
    updateTrade,
    clearTrades,
  };
}
