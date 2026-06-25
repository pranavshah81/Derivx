/**
 * Local Database — IndexedDB-based storage for offline market data
 * 
 * Stores:
 *   1. Instruments — F&O stock master (symbol, securityId, lotSize, exchangeSegment)
 *   2. Price Snapshots — Latest known prices for all instruments  
 *   3. Candle History — 1-2 days of intraday OHLCV candles for charts
 *   4. Metadata — Last update timestamps, version info
 * 
 * Uses IndexedDB for large data (localStorage has 5MB limit).
 */

// ── Types ──

export interface Instrument {
  securityId: string;
  symbol: string;
  tradingSymbol: string;
  exchangeSegment: string;
  instrumentType: string;
  lotSize: number;
  expiryDate?: string;
  strikePrice?: number;
  optionType?: string;
}

export interface PriceSnapshot {
  securityId: string;
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  volume: number;
  oi: number;
  timestamp: number;
}

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}

export interface CandleHistory {
  securityId: string;
  symbol: string;
  exchangeSegment: string;
  interval: string; // "5" = 5min candles
  candles: CandleData[];
  lastUpdated: number;
}

export interface DatabaseMetadata {
  key: string;
  value: string;
  updatedAt: number;
}

// ── IndexedDB Manager ──

const DB_NAME = "mrchartist_market_db";
const DB_VERSION = 3;

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Instruments store
      if (!db.objectStoreNames.contains("instruments")) {
        const instrumentStore = db.createObjectStore("instruments", { keyPath: "securityId" });
        instrumentStore.createIndex("symbol", "symbol", { unique: false });
        instrumentStore.createIndex("exchangeSegment", "exchangeSegment", { unique: false });
        instrumentStore.createIndex("instrumentType", "instrumentType", { unique: false });
      }

      // Price snapshots
      if (!db.objectStoreNames.contains("prices")) {
        const priceStore = db.createObjectStore("prices", { keyPath: "securityId" });
        priceStore.createIndex("symbol", "symbol", { unique: false });
      }

      // Candle history
      if (!db.objectStoreNames.contains("candles")) {
        const candleStore = db.createObjectStore("candles", { keyPath: ["securityId", "interval"] });
        candleStore.createIndex("symbol", "symbol", { unique: false });
      }

      // Metadata
      if (!db.objectStoreNames.contains("metadata")) {
        db.createObjectStore("metadata", { keyPath: "key" });
      }

      // Trades — persistent ORB paper trades
      if (!db.objectStoreNames.contains("trades")) {
        const tradeStore = db.createObjectStore("trades", { keyPath: "id" });
        tradeStore.createIndex("symbol", "symbol", { unique: false });
        tradeStore.createIndex("date", "date", { unique: false });
        tradeStore.createIndex("status", "status", { unique: false });
        tradeStore.createIndex("strategy", "strategy", { unique: false });
      }

      // Journal entries — notes linked to a trade
      if (!db.objectStoreNames.contains("journal")) {
        const journalStore = db.createObjectStore("journal", { keyPath: "id" });
        journalStore.createIndex("tradeId", "tradeId", { unique: false });
        journalStore.createIndex("date", "date", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"));
    };
  });
}

// ── Generic CRUD operations ──

async function putItem(storeName: string, item: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putItems(storeName: string, items: any[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getItem<T>(storeName: string, key: any): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

async function getAllItems<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

async function getItemsByIndex<T>(storeName: string, indexName: string, value: any): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const index = tx.objectStore(storeName).index(indexName);
    const request = index.getAll(value);
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function countItems(storeName: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Public API ──

// Instruments
export const saveInstruments = (items: Instrument[]) => putItems("instruments", items);
export const getInstrument = (securityId: string) => getItem<Instrument>("instruments", securityId);
export const getAllInstruments = () => getAllItems<Instrument>("instruments");
export const getInstrumentsBySegment = (segment: string) => getItemsByIndex<Instrument>("instruments", "exchangeSegment", segment);
export const getInstrumentsByType = (type: string) => getItemsByIndex<Instrument>("instruments", "instrumentType", type);
export const clearInstruments = () => clearStore("instruments");
export const countInstruments = () => countItems("instruments");

// Instrument lookup by symbol
export async function findInstrumentBySymbol(symbol: string): Promise<Instrument | undefined> {
  const results = await getItemsByIndex<Instrument>("instruments", "symbol", symbol);
  return results[0];
}

// Get all F&O stocks (unique equity symbols in NSE_FNO segment)
export async function getFnOStockList(): Promise<Instrument[]> {
  const fnoInstruments = await getInstrumentsBySegment("NSE_FNO");
  // Get unique underlying symbols (FUTSTK type gives us the stock names)
  const seen = new Set<string>();
  return fnoInstruments
    .filter((i) => {
      if (i.instrumentType === "FUTSTK" && !seen.has(i.symbol)) {
        seen.add(i.symbol);
        return true;
      }
      return false;
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// Prices
export const savePriceSnapshot = (item: PriceSnapshot) => putItem("prices", item);
export const savePriceSnapshots = (items: PriceSnapshot[]) => putItems("prices", items);
export const getPriceSnapshot = (securityId: string) => getItem<PriceSnapshot>("prices", securityId);
export const getAllPriceSnapshots = () => getAllItems<PriceSnapshot>("prices");
export const clearPrices = () => clearStore("prices");
export const countPrices = () => countItems("prices");

// Get price by symbol
export async function getPriceBySymbol(symbol: string): Promise<PriceSnapshot | undefined> {
  const results = await getItemsByIndex<PriceSnapshot>("prices", "symbol", symbol);
  return results[0];
}

// Candle history
export const saveCandleHistory = (item: CandleHistory) => putItem("candles", item);
export const getCandleHistory = (securityId: string, interval: string) =>
  getItem<CandleHistory>("candles", [securityId, interval]);
export const getAllCandleHistories = () => getAllItems<CandleHistory>("candles");
export const clearCandles = () => clearStore("candles");
export const countCandles = () => countItems("candles");

// Metadata
export const setMetadata = (key: string, value: string) =>
  putItem("metadata", { key, value, updatedAt: Date.now() } as DatabaseMetadata);
export const getMetadata = (key: string) => getItem<DatabaseMetadata>("metadata", key);

// ── Database Stats ──

export interface DatabaseStats {
  instruments: number;
  prices: number;
  candles: number;
  lastInstrumentUpdate: string | null;
  lastPriceUpdate: string | null;
  lastCandleUpdate: string | null;
}

export async function getDatabaseStats(): Promise<DatabaseStats> {
  const [instruments, prices, candles, instrMeta, priceMeta, candleMeta] = await Promise.all([
    countInstruments(),
    countPrices(),
    countCandles(),
    getMetadata("lastInstrumentUpdate"),
    getMetadata("lastPriceUpdate"),
    getMetadata("lastCandleUpdate"),
  ]);

  return {
    instruments,
    prices,
    candles,
    lastInstrumentUpdate: instrMeta?.value || null,
    lastPriceUpdate: priceMeta?.value || null,
    lastCandleUpdate: candleMeta?.value || null,
  };
}

// ── Clear entire database ──

export async function clearAllData(): Promise<void> {
  await Promise.all([clearInstruments(), clearPrices(), clearCandles()]);
}

// ── Trade Journal Types ──

export type TradeStatus = "OPEN" | "SL_HIT" | "COST_HIT" | "TARGET_HIT" | "MANUAL_EXIT";
export type TradeDirection = "bullish" | "bearish";
export type TradeEmotion = "calm" | "confident" | "fearful" | "greedy" | "uncertain" | "disciplined";

export interface StoredTrade {
  id: string;
  strategy: "ORB";
  date: string;           // YYYY-MM-DD — for date-based filtering
  symbol: string;
  sector: string;
  direction: TradeDirection;
  optionType: "CE" | "PE";
  atmStrike: number;
  lotSize: number;
  entryStockPrice: number;
  entryTime: number;
  exitStockPrice: number | null;
  exitTime: number | null;
  slPrice: number;
  orbHigh: number;
  orbLow: number;
  reentryCount: number;
  status: TradeStatus;
  estimatedPremium: number;
  finalPnL: number | null;
  // ── New strategy fields (optional for backward compat) ──
  initialSL?: number;
  risk?: number;
  target1?: number;
  target2?: number;
  slMovedToCost?: boolean;
  partialBooked?: boolean;
  partialExitPrice?: number | null;
  partialExitTime?: number | null;
  shares?: number;
}

export interface JournalEntry {
  id: string;
  tradeId: string;
  date: string;           // YYYY-MM-DD
  createdAt: number;
  updatedAt: number;
  notes: string;
  emotion: TradeEmotion | "";
  rating: number;         // 1–5 execution quality
  tags: string[];
  lesson: string;
  followedPlan: boolean | null;
}

// ── Trades CRUD ──

export const saveTrade = (trade: StoredTrade) => putItem("trades", trade);
export const getTrade = (id: string) => getItem<StoredTrade>("trades", id);
export const getAllTrades = () => getAllItems<StoredTrade>("trades");
export const getTradesByDate = (date: string) =>
  getItemsByIndex<StoredTrade>("trades", "date", date);
export const getTradesBySymbol = (symbol: string) =>
  getItemsByIndex<StoredTrade>("trades", "symbol", symbol);
export const deleteTrade = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trades", "readwrite");
    tx.objectStore("trades").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};
export const countTrades = () => countItems("trades");

// ── Journal CRUD ──

export const saveJournalEntry = (entry: JournalEntry) => putItem("journal", entry);
export const getJournalEntry = (id: string) => getItem<JournalEntry>("journal", id);
export const getAllJournalEntries = () => getAllItems<JournalEntry>("journal");
export const getJournalByTradeId = (tradeId: string) =>
  getItemsByIndex<JournalEntry>("journal", "tradeId", tradeId);
export const deleteJournalEntry = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("journal", "readwrite");
    tx.objectStore("journal").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// ── Aggregate trade stats ──

export interface TradeStats {
  total: number;
  open: number;
  wins: number;
  losses: number;
  slHits: number;
  winRate: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  bestTrade: StoredTrade | null;
  worstTrade: StoredTrade | null;
  avgReentryCount: number;
}

export async function getTradeStats(): Promise<TradeStats> {
  const trades = await getAllTrades();
  const closed = trades.filter(t => t.status !== "OPEN" && t.finalPnL !== null);
  const wins = closed.filter(t => (t.finalPnL ?? 0) > 0);
  const losses = closed.filter(t => (t.finalPnL ?? 0) <= 0);
  const totalPnL = closed.reduce((s, t) => s + (t.finalPnL ?? 0), 0);
  const grossWin = wins.reduce((s, t) => s + (t.finalPnL ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.finalPnL ?? 0), 0));
  const sorted = [...closed].sort((a, b) => (b.finalPnL ?? 0) - (a.finalPnL ?? 0));

  return {
    total: trades.length,
    open: trades.filter(t => t.status === "OPEN").length,
    wins: wins.length,
    losses: losses.length,
    slHits: trades.filter(t => t.status === "SL_HIT").length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    totalPnL,
    avgWin: wins.length > 0 ? grossWin / wins.length : 0,
    avgLoss: losses.length > 0 ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    bestTrade: sorted[0] ?? null,
    worstTrade: sorted[sorted.length - 1] ?? null,
    avgReentryCount: trades.length > 0
      ? trades.reduce((s, t) => s + t.reentryCount, 0) / trades.length
      : 0,
  };
}
