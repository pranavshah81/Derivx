import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  BookOpen, TrendingUp, TrendingDown, Target, BarChart2, Trash2,
  Download, Star, Filter, Search, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Smile, Frown, Meh, Zap,
  ArrowUpRight, ArrowDownRight, Activity, Award, AlertTriangle,
} from "lucide-react";
import { TradeDetailChart } from "@/components/TradeDetailChart";
import {
  getAllTrades, getAllJournalEntries, saveJournalEntry, deleteJournalEntry,
  deleteTrade, getTradeStats,
  type StoredTrade, type JournalEntry, type TradeEmotion, type TradeStats,
} from "@/lib/localDatabase";

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtDateShort(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y}`;
}

function statusColor(status: StoredTrade["status"]) {
  if (status === "OPEN") return "text-primary border-primary/40";
  if (status === "SL_HIT") return "text-bearish border-bearish/40";
  if (status === "TARGET_HIT") return "text-bullish border-bullish/40";
  return "text-muted-foreground border-border/40";
}

const EMOTIONS: { value: TradeEmotion; label: string; icon: string }[] = [
  { value: "calm", label: "Calm", icon: "😌" },
  { value: "confident", label: "Confident", icon: "💪" },
  { value: "disciplined", label: "Disciplined", icon: "🎯" },
  { value: "uncertain", label: "Uncertain", icon: "🤔" },
  { value: "fearful", label: "Fearful", icon: "😨" },
  { value: "greedy", label: "Greedy", icon: "🤑" },
];

const TAGS = ["ORB", "Re-entry", "SL Hit", "Followed Plan", "FOMO", "Early Exit", "Disciplined", "Revenge Trade", "Trending", "Choppy"];

// ── Stat Card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "" }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/60 backdrop-blur p-4 flex flex-col gap-1">
      <p className="text-xs text-muted-foreground/70 font-medium">{label}</p>
      <p className={`text-2xl font-bold font-mono tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground/50">{sub}</p>}
    </div>
  );
}

// ── Journal Entry Form ────────────────────────────────────────────────────
interface JournalFormProps {
  trade: StoredTrade;
  existing: JournalEntry | null;
  onSave: (entry: JournalEntry) => void;
  onClose: () => void;
}

function JournalForm({ trade, existing, onSave, onClose }: JournalFormProps) {
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [lesson, setLesson] = useState(existing?.lesson ?? "");
  const [emotion, setEmotion] = useState<TradeEmotion | "">(existing?.emotion ?? "");
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [followedPlan, setFollowedPlan] = useState<boolean | null>(existing?.followedPlan ?? null);

  const toggleTag = (t: string) =>
    setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const handleSave = () => {
    const now = Date.now();
    const d = new Date(now);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const entry: JournalEntry = {
      id: existing?.id ?? `jrn-${trade.id}-${now}`,
      tradeId: trade.id,
      date,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      notes,
      emotion,
      rating,
      tags,
      lesson,
      followedPlan,
    };
    onSave(entry);
  };

  const pnl = trade.finalPnL ?? 0;

  return (
    <div className="space-y-5">
      {/* Trade summary strip */}
      <div className={`rounded-lg border px-4 py-3 flex flex-wrap items-center gap-4 text-sm ${
        pnl >= 0 ? "border-bullish/20 bg-bullish/5" : "border-bearish/20 bg-bearish/5"
      }`}>
        <span className={`font-bold font-mono text-base ${pnl >= 0 ? "text-bullish" : "text-bearish"}`}>
          {trade.symbol} {trade.atmStrike}{trade.optionType}
        </span>
        <span className="text-muted-foreground text-xs">{fmtDate(trade.entryTime)}</span>
        <Badge variant="outline" className={`text-xs ${statusColor(trade.status)}`}>{trade.status}</Badge>
        {trade.finalPnL !== null && (
          <span className={`ml-auto font-mono font-bold ${pnl >= 0 ? "text-bullish" : "text-bearish"}`}>
            {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(0)}
          </span>
        )}
      </div>

      {/* Execution rating */}
      <div className="space-y-1.5">
        <Label className="text-xs">Execution Quality</Label>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setRating(n)}
              className={`h-8 w-8 rounded-lg border text-sm transition-all ${
                n <= rating
                  ? "border-warning/60 bg-warning/15 text-warning"
                  : "border-border/30 text-muted-foreground/30 hover:text-warning/50"
              }`}
            >
              ★
            </button>
          ))}
          {rating > 0 && (
            <span className="text-xs text-muted-foreground/60 self-center ml-1">
              {["", "Poor", "Below Avg", "Average", "Good", "Excellent"][rating]}
            </span>
          )}
        </div>
      </div>

      {/* Emotion */}
      <div className="space-y-1.5">
        <Label className="text-xs">Emotion during trade</Label>
        <div className="flex flex-wrap gap-2">
          {EMOTIONS.map(e => (
            <button
              key={e.value}
              onClick={() => setEmotion(prev => prev === e.value ? "" : e.value)}
              className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all flex items-center gap-1 ${
                emotion === e.value
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/30 text-muted-foreground/70 hover:border-border/60"
              }`}
            >
              {e.icon} {e.label}
            </button>
          ))}
        </div>
      </div>

      {/* Followed plan */}
      <div className="space-y-1.5">
        <Label className="text-xs">Did you follow your plan?</Label>
        <div className="flex gap-2">
          {([true, false, null] as const).map((v, i) => (
            <button
              key={i}
              onClick={() => setFollowedPlan(v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                followedPlan === v
                  ? v === true ? "border-bullish/50 bg-bullish/10 text-bullish"
                    : v === false ? "border-bearish/50 bg-bearish/10 text-bearish"
                    : "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/30 text-muted-foreground/50 hover:border-border/60"
              }`}
            >
              {v === true ? "✓ Yes" : v === false ? "✗ No" : "— N/A"}
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-1.5">
        <Label className="text-xs">Tags</Label>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map(t => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              className={`px-2 py-0.5 rounded-full text-xs border transition-all ${
                tags.includes(t)
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/30 text-muted-foreground/50 hover:border-border/60"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label className="text-xs">Trade Notes</Label>
        <Textarea
          placeholder="Why did you take this trade? What was the setup? How did the ORB break?"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="text-sm min-h-[80px] resize-none"
        />
      </div>

      {/* Lesson */}
      <div className="space-y-1.5">
        <Label className="text-xs">Lesson Learned</Label>
        <Textarea
          placeholder="What would you do differently next time?"
          value={lesson}
          onChange={e => setLesson(e.target.value)}
          className="text-sm min-h-[60px] resize-none"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleSave}>
          <BookOpen className="h-3.5 w-3.5 mr-1.5" />
          Save Journal Entry
        </Button>
      </div>
    </div>
  );
}

// ── Trade Row ─────────────────────────────────────────────────────────────
interface TradeRowProps {
  trade: StoredTrade;
  journal: JournalEntry | null;
  onJournal: () => void;
  onDelete: () => void;
}

function TradeRow({ trade, journal, onJournal, onDelete }: TradeRowProps) {
  const [open, setOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const pnl = trade.finalPnL ?? 0;
  const isBull = trade.direction === "bullish";

  return (
    <div className="rounded-xl border border-border/40 bg-card/50 hover:bg-card/80 transition-all">
      {/* Main row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setOpen(p => !p)}
      >
        {/* Direction */}
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
          isBull ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"
        }`}>
          {isBull ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        </div>

        {/* Symbol */}
        <div className="w-32 shrink-0">
          <p className="text-sm font-bold font-mono">
            {trade.symbol} {trade.atmStrike}{trade.optionType}
          </p>
          <p className="text-xs text-muted-foreground/60">{trade.sector}</p>
        </div>

        {/* Date */}
        <div className="hidden sm:block w-28 shrink-0">
          <p className="text-xs text-muted-foreground">{fmtDateShort(trade.date)}</p>
          <p className="text-xs text-muted-foreground/50 font-mono">
            {new Date(trade.entryTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </p>
        </div>

        {/* Entry / Exit */}
        <div className="hidden md:block w-28 shrink-0 text-xs font-mono">
          <p className="text-muted-foreground/70">₹{trade.entryStockPrice.toFixed(2)}</p>
          {trade.exitStockPrice && (
            <p className="text-muted-foreground/50">→ ₹{trade.exitStockPrice.toFixed(2)}</p>
          )}
        </div>

        {/* SL */}
        <div className="hidden lg:block w-20 shrink-0 text-xs font-mono text-warning/70">
          SL ₹{trade.slPrice.toFixed(0)}
        </div>

        {/* Status */}
        <Badge variant="outline" className={`text-xs shrink-0 ${statusColor(trade.status)}`}>
          {trade.status}
        </Badge>

        {/* P&L */}
        <div className="flex-1 text-right">
          {trade.finalPnL !== null ? (
            <span className={`text-sm font-bold font-mono ${pnl >= 0 ? "text-bullish" : "text-bearish"}`}>
              {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(0)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/40">Open</span>
          )}
        </div>

        {/* Journal indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          {journal && (
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map(n => (
                <span key={n} className={`text-xs ${n <= (journal.rating ?? 0) ? "text-warning" : "text-muted-foreground/20"}`}>★</span>
              ))}
            </div>
          )}
          <BookOpen className={`h-3.5 w-3.5 ${journal ? "text-primary" : "text-muted-foreground/30"}`} />
          {open ? <ChevronUp className="h-3 w-3 text-muted-foreground/40" /> : <ChevronDown className="h-3 w-3 text-muted-foreground/40" />}
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border/30 px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground/60">ORB Range</p>
              <p className="font-mono">H:{trade.orbHigh.toFixed(0)} / L:{trade.orbLow.toFixed(0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground/60">Lot Size</p>
              <p className="font-mono">{trade.lotSize}</p>
            </div>
            <div>
              <p className="text-muted-foreground/60">Est. Premium</p>
              <p className="font-mono">₹{trade.estimatedPremium.toFixed(0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground/60">Re-entries</p>
              <p className="font-mono">{trade.reentryCount}</p>
            </div>
          </div>

          {/* Journal preview */}
          {journal && (
            <div className="rounded-lg border border-primary/20 bg-primary/3 p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                {journal.emotion && (
                  <span className="text-muted-foreground">
                    {EMOTIONS.find(e => e.value === journal.emotion)?.icon} {journal.emotion}
                  </span>
                )}
                {journal.followedPlan !== null && (
                  <span className={journal.followedPlan ? "text-bullish" : "text-bearish"}>
                    {journal.followedPlan ? "✓ Followed plan" : "✗ Deviated from plan"}
                  </span>
                )}
                {journal.tags.map(t => (
                  <Badge key={t} variant="outline" className="text-xs h-4 px-1.5 border-primary/30 text-primary/70">{t}</Badge>
                ))}
              </div>
              {journal.notes && <p className="text-muted-foreground/80 leading-relaxed">{journal.notes}</p>}
              {journal.lesson && (
                <div className="flex gap-1.5">
                  <Zap className="h-3 w-3 text-warning/70 shrink-0 mt-0.5" />
                  <p className="text-warning/80">{journal.lesson}</p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={onJournal}>
              <BookOpen className="h-3 w-3" />
              {journal ? "Edit Journal" : "Add Journal"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 border-primary/30 text-primary/80 hover:bg-primary/10"
              onClick={() => setChartOpen(true)}
            >
              <BarChart2 className="h-3 w-3" />
              View Chart
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground/50 hover:text-bearish ml-auto"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
          </div>
        </div>
      )}

      {/* Trade chart dialog */}
      <Dialog open={chartOpen} onOpenChange={setChartOpen}>
        <DialogContent className="max-w-3xl w-full">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" />
              <span className={`font-bold font-mono ${isBull ? "text-bullish" : "text-bearish"}`}>{trade.symbol}</span>
              <span className="text-muted-foreground/50 font-normal">— Trade Detail · {trade.date}</span>
            </DialogTitle>
          </DialogHeader>
          <TradeDetailChart trade={trade} height={360} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Analytics Panel ───────────────────────────────────────────────────────
function AnalyticsPanel({ stats, trades }: { stats: TradeStats; trades: StoredTrade[] }) {
  // Daily P&L for sparkline-style display
  const dailyPnL = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of trades.filter(t => t.finalPnL !== null)) {
      map.set(t.date, (map.get(t.date) ?? 0) + (t.finalPnL ?? 0));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => ({ date, pnl }));
  }, [trades]);

  // Symbol breakdown
  const bySymbol = useMemo(() => {
    const map = new Map<string, { trades: number; pnl: number }>();
    for (const t of trades.filter(t => t.finalPnL !== null)) {
      const cur = map.get(t.symbol) ?? { trades: 0, pnl: 0 };
      map.set(t.symbol, { trades: cur.trades + 1, pnl: cur.pnl + (t.finalPnL ?? 0) });
    }
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b.pnl - a.pnl)
      .slice(0, 6);
  }, [trades]);

  return (
    <div className="space-y-4">
      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total Trades" value={stats.total} />
        <StatCard
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          sub={`${stats.wins}W / ${stats.losses}L`}
          color={stats.winRate >= 50 ? "text-bullish" : "text-bearish"}
        />
        <StatCard
          label="Net P&L"
          value={`${stats.totalPnL >= 0 ? "+" : ""}₹${stats.totalPnL.toFixed(0)}`}
          color={stats.totalPnL >= 0 ? "text-bullish" : "text-bearish"}
        />
        <StatCard
          label="Avg Win"
          value={`+₹${stats.avgWin.toFixed(0)}`}
          color="text-bullish"
        />
        <StatCard
          label="Avg Loss"
          value={`₹${stats.avgLoss.toFixed(0)}`}
          color="text-bearish"
        />
        <StatCard
          label="Profit Factor"
          value={stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
          sub={stats.slHits > 0 ? `${stats.slHits} SL hits` : undefined}
          color={stats.profitFactor >= 1.5 ? "text-bullish" : stats.profitFactor >= 1 ? "text-warning" : "text-bearish"}
        />
      </div>

      {/* Best / Worst */}
      {(stats.bestTrade || stats.worstTrade) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {stats.bestTrade && (
            <div className="rounded-xl border border-bullish/20 bg-bullish/5 p-3 flex items-center gap-3">
              <Award className="h-5 w-5 text-bullish shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground/70">Best Trade</p>
                <p className="text-sm font-bold font-mono">{stats.bestTrade.symbol} {stats.bestTrade.atmStrike}{stats.bestTrade.optionType}</p>
              </div>
              <span className="text-sm font-bold text-bullish font-mono">+₹{(stats.bestTrade.finalPnL ?? 0).toFixed(0)}</span>
            </div>
          )}
          {stats.worstTrade && (
            <div className="rounded-xl border border-bearish/20 bg-bearish/5 p-3 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-bearish shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground/70">Worst Trade</p>
                <p className="text-sm font-bold font-mono">{stats.worstTrade.symbol} {stats.worstTrade.atmStrike}{stats.worstTrade.optionType}</p>
              </div>
              <span className="text-sm font-bold text-bearish font-mono">₹{(stats.worstTrade.finalPnL ?? 0).toFixed(0)}</span>
            </div>
          )}
        </div>
      )}

      {/* Daily P&L */}
      {dailyPnL.length > 0 && (
        <Card className="border-border/40 bg-card/50">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Daily P&L
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex items-end gap-1.5 h-16">
              {dailyPnL.map(({ date, pnl }) => {
                const max = Math.max(...dailyPnL.map(d => Math.abs(d.pnl)), 1);
                const h = Math.max(4, (Math.abs(pnl) / max) * 56);
                return (
                  <div key={date} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={`${fmtDateShort(date)}: ${pnl >= 0 ? "+" : ""}₹${pnl.toFixed(0)}`}>
                    <div
                      className={`w-full rounded-t-sm ${pnl >= 0 ? "bg-bullish/60" : "bg-bearish/60"}`}
                      style={{ height: h }}
                    />
                    <span className="text-xs text-muted-foreground/40 truncate w-full text-center" style={{ fontSize: 9 }}>
                      {date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Symbol breakdown */}
      {bySymbol.length > 0 && (
        <Card className="border-border/40 bg-card/50">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" /> By Symbol
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {bySymbol.map(([sym, { trades: n, pnl }]) => (
              <div key={sym} className="flex items-center gap-3 text-xs">
                <span className="w-24 font-mono font-medium truncate">{sym}</span>
                <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${pnl >= 0 ? "bg-bullish/60" : "bg-bearish/60"}`}
                    style={{ width: `${Math.min(100, Math.abs(pnl) / Math.max(...bySymbol.map(([, x]) => Math.abs(x.pnl))) * 100)}%` }}
                  />
                </div>
                <span className="w-12 text-right text-muted-foreground/60">{n} trades</span>
                <span className={`w-16 text-right font-mono font-bold ${pnl >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(0)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Export ─────────────────────────────────────────────────────────────────
function exportCSV(trades: StoredTrade[], journals: JournalEntry[]) {
  const journalMap = new Map(journals.map(j => [j.tradeId, j]));
  const rows = [
    ["Date", "Symbol", "Strike", "Type", "Direction", "Entry", "Exit", "SL", "Status", "P&L", "Lot", "Reentries", "Rating", "Emotion", "Tags", "Notes", "Lesson"],
    ...trades.map(t => {
      const j = journalMap.get(t.id);
      return [
        t.date, t.symbol, t.atmStrike, t.optionType, t.direction,
        t.entryStockPrice.toFixed(2), t.exitStockPrice?.toFixed(2) ?? "",
        t.slPrice.toFixed(2), t.status, (t.finalPnL ?? "").toString(),
        t.lotSize, t.reentryCount,
        j?.rating ?? "", j?.emotion ?? "", (j?.tags ?? []).join("; "),
        (j?.notes ?? "").replace(/\n/g, " "), (j?.lesson ?? "").replace(/\n/g, " "),
      ];
    }),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orb-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function TradeJournal() {
  const qc = useQueryClient();
  const [journalOpen, setJournalOpen] = useState(false);
  const [activeTrade, setActiveTrade] = useState<StoredTrade | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDate, setFilterDate] = useState<string>("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const { data: trades = [] } = useQuery({ queryKey: ["orb-paper-trades"], queryFn: getAllTrades, staleTime: Infinity });
  const { data: journals = [] } = useQuery({ queryKey: ["orb-journals"], queryFn: getAllJournalEntries, staleTime: Infinity });
  const { data: stats } = useQuery({ queryKey: ["orb-trade-stats"], queryFn: getTradeStats, staleTime: 0 });

  const journalMap = useMemo(() => new Map(journals.map(j => [j.tradeId, j])), [journals]);

  const filtered = useMemo(() => {
    let list = [...trades];
    if (search) list = list.filter(t => t.symbol.toLowerCase().includes(search.toLowerCase()) || t.sector.toLowerCase().includes(search.toLowerCase()));
    if (filterStatus !== "all") list = list.filter(t => t.status === filterStatus);
    if (filterDate) list = list.filter(t => t.date === filterDate);
    list.sort((a, b) => sortDir === "desc" ? b.entryTime - a.entryTime : a.entryTime - b.entryTime);
    return list;
  }, [trades, search, filterStatus, filterDate, sortDir]);

  const handleSaveJournal = useCallback(async (entry: JournalEntry) => {
    await saveJournalEntry(entry);
    qc.invalidateQueries({ queryKey: ["orb-journals"] });
    qc.invalidateQueries({ queryKey: ["orb-trade-stats"] });
    setJournalOpen(false);
    setActiveTrade(null);
    toast.success("Journal entry saved");
  }, [qc]);

  const handleDeleteTrade = useCallback(async (id: string) => {
    await deleteTrade(id);
    qc.invalidateQueries({ queryKey: ["orb-paper-trades"] });
    qc.invalidateQueries({ queryKey: ["orb-trade-stats"] });
    toast.info("Trade deleted");
  }, [qc]);

  const openJournal = useCallback((trade: StoredTrade) => {
    setActiveTrade(trade);
    setJournalOpen(true);
  }, []);

  return (
    <div className="space-y-5 p-1">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <BookOpen className="h-6 w-6 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.5)]" />
            Trade Journal
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All ORB paper trades · persistent in IndexedDB · journal every trade
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => exportCSV(trades, journals)}
            disabled={trades.length === 0}
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <Tabs defaultValue="trades">
        <TabsList className="h-8">
          <TabsTrigger value="trades" className="text-xs h-7 gap-1.5">
            All Trades <Badge variant="outline" className="text-xs h-4 px-1.5 ml-0.5">{trades.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs h-7 gap-1.5">
            <Activity className="h-3 w-3" /> Analytics
          </TabsTrigger>
        </TabsList>

        {/* ── Trades Tab ── */}
        <TabsContent value="trades" className="mt-4 space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              <Input
                placeholder="Search symbol..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All</SelectItem>
                <SelectItem value="OPEN" className="text-xs">Open</SelectItem>
                <SelectItem value="SL_HIT" className="text-xs">SL Hit</SelectItem>
                <SelectItem value="MANUAL_EXIT" className="text-xs">Exited</SelectItem>
                <SelectItem value="TARGET_HIT" className="text-xs">Target Hit</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              className="h-8 w-36 text-xs"
            />
            {(search || filterStatus !== "all" || filterDate) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => { setSearch(""); setFilterStatus("all"); setFilterDate(""); }}
              >
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs ml-auto gap-1 text-muted-foreground"
              onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}
            >
              {sortDir === "desc" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              Date
            </Button>
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <BookOpen className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {trades.length === 0 ? "No trades recorded yet" : "No trades match the filter"}
              </p>
              <p className="text-xs text-muted-foreground/50 mt-1">
                {trades.length === 0 ? "Trades taken in ORB Strategy are stored here automatically" : "Try clearing the filters"}
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="space-y-2 pr-1">
                {filtered.map(trade => (
                  <TradeRow
                    key={trade.id}
                    trade={trade}
                    journal={journalMap.get(trade.id) ?? null}
                    onJournal={() => openJournal(trade)}
                    onDelete={() => handleDeleteTrade(trade.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        {/* ── Analytics Tab ── */}
        <TabsContent value="analytics" className="mt-4">
          {!stats || trades.length === 0 ? (
            <div className="py-16 text-center">
              <BarChart2 className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No closed trades to analyse yet</p>
            </div>
          ) : (
            <AnalyticsPanel stats={stats} trades={trades} />
          )}
        </TabsContent>
      </Tabs>

      {/* Journal dialog */}
      <Dialog open={journalOpen} onOpenChange={setJournalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-primary" />
              Journal Entry
            </DialogTitle>
          </DialogHeader>
          {activeTrade && (
            <JournalForm
              trade={activeTrade}
              existing={journalMap.get(activeTrade.id) ?? null}
              onSave={handleSaveJournal}
              onClose={() => { setJournalOpen(false); setActiveTrade(null); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
