import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  BookOpen,
  Brain,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  Flag,
  Flame,
  Link2,
  Lock,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";

const STORAGE_KEY = "discipline-trader-toolkit-v13";
const APPROVED_UI_VERSION = "v13";
const HOLD_TO_DRAG_MS = 500;

const defaultRules = {
  propFirm: "Topstep",
  accountSize: "50K",
  focusMarkets: "MNQ, MES",
  session: "8:30 AM–11:00 AM CT",
  primarySetup: "Opening range pullback / trend continuation",
  secondarySetup: "None for now",
  maxRiskPerTradeR: "1R",
  maxDailyLossR: "-2R",
  dailyGoalR: "+2R",
  maxTradesPerDay: 2,
  maxLossesPerDay: 2,
  entryRule: "Only A setups. Stop must be obvious first.",
  managementRule: "No adding to losers. No widening stop. Scale out only if planned.",
  stopRule: "After 2 losses, -2R, or a real emotional spike, stop for the day.",
  newsRule: "No new trade 5 minutes before or after major scheduled news.",
  mindRule: "No trade is better than a forced trade.",
};

const starterChecklist = [
  { id: "sleep", text: "I am clear-headed enough to trade.", checked: false },
  { id: "calendar", text: "I checked scheduled news and wrote no-trade windows.", checked: false },
  { id: "levels", text: "I marked key levels, bias, and invalidation.", checked: false },
  { id: "risk", text: "My size and max loss are set before open.", checked: false },
  { id: "setup", text: "I am only trading my written setup.", checked: false },
  { id: "emotion", text: "I agree to stop if I tilt or break a rule.", checked: false },
];

const starterLinks = [
  { id: "1", name: "TradingView", url: "https://www.tradingview.com/", note: "Charting, alerts, watchlists" },
  { id: "2", name: "Economic Calendar", url: "https://www.forexfactory.com/calendar", note: "News planning" },
  { id: "3", name: "TopstepX", url: "https://www.topstep.com/topstepx/", note: "Execution" },
  { id: "4", name: "Finviz", url: "https://finviz.com/", note: "Stock filtering" },
  { id: "5", name: "TrendSpider", url: "https://trendspider.com/", note: "Advanced scans" },
];

const defaultReminders = [
  { id: "r1", text: "One clean day repeated beats one giant day chased." },
  { id: "r2", text: "If the stop is not obvious, it is not your trade." },
  { id: "r3", text: "A skipped bad trade is a win worth journaling." },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cloneChecklist() {
  return starterChecklist.map((item) => ({ ...item }));
}

function cloneReminders() {
  return defaultReminders.map((item) => ({ ...item }));
}

function baseDay() {
  return {
    checklist: cloneChecklist(),
    premarketPlan: "",
    executionNotes: "",
    review: "",
    lesson: "",
    mood: "Calm",
    dayLocked: false,
    dayLockUntil: "",
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ensureDayShape(state, date) {
  if (state.daily?.[date]) return state;
  return {
    ...state,
    daily: {
      ...(state.daily || {}),
      [date]: baseDay(),
    },
  };
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatLocalDateTimeInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function endOfDayLocalInputValue() {
  const end = new Date();
  end.setHours(23, 59, 0, 0);
  return formatLocalDateTimeInput(end);
}

function isDayLocked(day) {
  if (!day?.dayLocked) return false;
  if (!day.dayLockUntil) return true;
  const until = new Date(day.dayLockUntil).getTime();
  if (!Number.isFinite(until)) return true;
  return Date.now() < until;
}

function getDaySummary(day, trades) {
  const dayR = trades.reduce((sum, t) => sum + toNum(t.resultR), 0);
  const ruleBreaks = trades.filter((t) => !t.followedRules).length;
  const checklistDone = day.checklist.filter((item) => item.checked).length;
  const checklistPct = Math.round((checklistDone / Math.max(day.checklist.length, 1)) * 100);
  return { dayR, ruleBreaks, checklistPct, count: trades.length };
}

function reorderById(items, fromId, toId) {
  const fromIndex = items.findIndex((item) => item.id === fromId);
  const toIndex = items.findIndex((item) => item.id === toId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return items;
  const copy = [...items];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

function softButtonClasses(variant = "primary") {
  const base = "rounded-2xl transition-all duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed";
  if (variant === "ghost") {
    return `${base} border border-white/10 bg-white/5 text-white hover:bg-white/10 active:bg-white/15`;
  }
  if (variant === "danger") {
    return `${base} bg-red-500 text-white hover:bg-red-400 active:bg-red-600 shadow-lg shadow-red-500/20`;
  }
  return `${base} bg-emerald-400 text-zinc-950 hover:bg-emerald-300 active:bg-emerald-500 shadow-lg shadow-emerald-500/20`;
}

function statCard(label, value, sub, Icon) {
  return { label, value, sub, Icon };
}

function dayStatus(state, dayTrades, day) {
  const resultR = dayTrades.reduce((sum, t) => sum + toNum(t.resultR), 0);
  const losses = dayTrades.filter((t) => toNum(t.resultR) < 0).length;
  if (day.dayLocked) return { label: "Locked", tone: "red", reason: "This date is currently locked." };
  if (resultR <= -2) return { label: "Stop trading", tone: "red", reason: "Daily loss limit hit." };
  if (losses >= state.rules.maxLossesPerDay) return { label: "Stop trading", tone: "red", reason: "Max losses reached." };
  if (dayTrades.length >= state.rules.maxTradesPerDay) return { label: "Trade cap reached", tone: "amber", reason: "You used your planned trades." };
  return { label: "Can trade", tone: "green", reason: "Still within plan." };
}

function HoldHint({ active }) {
  return active ? <p className="mt-2 text-xs text-emerald-200">Drag ready</p> : null;
}

export default function DisciplineTraderToolkit() {
  const [state, setState] = useState(() => {
    const saved = typeof window !== "undefined" ? loadState() : null;
    return saved || {
      rules: defaultRules,
      links: starterLinks,
      reminders: cloneReminders(),
      daily: { [todayKey()]: baseDay() },
      trades: [],
    };
  });

  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [pendingLockMode, setPendingLockMode] = useState("restOfDay");
  const [pendingLockHours, setPendingLockHours] = useState("4");
  const [pendingLockMinutes, setPendingLockMinutes] = useState("0");
  const [editingTools, setEditingTools] = useState(false);
  const [editingReminders, setEditingReminders] = useState(false);
  const [newTool, setNewTool] = useState({ name: "", url: "", note: "" });
  const [newReminder, setNewReminder] = useState("");
  const [tradeForm, setTradeForm] = useState({
    id: "",
    date: todayKey(),
    time: "",
    market: "MNQ",
    setup: defaultRules.primarySetup,
    direction: "Long",
    quality: "A",
    resultR: "",
    plannedRR: "2.0",
    thesis: "",
    mistake: "",
    tags: "",
    screenshotUrl: "",
    followedRules: true,
  });
  const [holdState, setHoldState] = useState({ list: "", id: "", progress: 0 });
  const [dragReady, setDragReady] = useState({ list: "", id: "" });
  const [draggingItem, setDraggingItem] = useState({ list: "", id: "" });

  const holdIntervalRef = useRef(null);
  const holdTimeoutRef = useRef(null);

  useEffect(() => {
    const next = ensureDayShape(state, selectedDate);
    if (next !== state) setState(next);
  }, [selectedDate]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    return () => {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    };
  }, []);

  const day = state.daily?.[selectedDate] || baseDay();
  const lockActive = isDayLocked(day);
  const reminders = state.reminders?.length ? state.reminders : cloneReminders();
  const dayTrades = useMemo(() => state.trades.filter((t) => t.date === selectedDate), [state.trades, selectedDate]);
  const allTrades = state.trades;

  const totalTrades = allTrades.length;
  const totalR = allTrades.reduce((sum, t) => sum + toNum(t.resultR), 0);
  const wins = allTrades.filter((t) => toNum(t.resultR) > 0).length;
  const losses = allTrades.filter((t) => toNum(t.resultR) < 0).length;
  const breakEvenTrades = allTrades.filter((t) => toNum(t.resultR) === 0).length;
  const winRate = totalTrades ? Math.round((wins / totalTrades) * 100) : 0;
  const ruleBreaks = allTrades.filter((t) => !t.followedRules).length;
  const ruleAdherence = totalTrades ? Math.round(((totalTrades - ruleBreaks) / totalTrades) * 100) : 100;
  const avgR = totalTrades ? totalR / totalTrades : 0;
  const avgWinner = wins ? allTrades.filter((t) => toNum(t.resultR) > 0).reduce((sum, t) => sum + toNum(t.resultR), 0) / wins : 0;
  const avgLoser = losses ? allTrades.filter((t) => toNum(t.resultR) < 0).reduce((sum, t) => sum + toNum(t.resultR), 0) / losses : 0;
  const expectancy = avgR;

  const dayR = dayTrades.reduce((sum, t) => sum + toNum(t.resultR), 0);
  const dayLosses = dayTrades.filter((t) => toNum(t.resultR) < 0).length;
  const checklistDone = day.checklist.filter((item) => item.checked).length;
  const checklistPct = Math.round((checklistDone / Math.max(day.checklist.length, 1)) * 100);
  const reviewDone = Boolean(day.review.trim()) && Boolean(day.lesson.trim());
  const dailyProgress = Math.round((((checklistPct === 100 ? 1 : checklistPct / 100) + (dayTrades.length > 0 ? 1 : 0) + (reviewDone ? 1 : 0)) / 3) * 100);

  const lastSevenTrades = allTrades.filter((t) => {
    const now = new Date(todayKey()).getTime();
    const then = new Date(t.date).getTime();
    return Number.isFinite(then) && (now - then) / (1000 * 60 * 60 * 24) <= 6;
  });
  const lastSevenR = lastSevenTrades.reduce((sum, t) => sum + toNum(t.resultR), 0);

  const aSetups = allTrades.filter((t) => t.quality === "A");
  const aWinRate = aSetups.length ? Math.round((aSetups.filter((t) => toNum(t.resultR) > 0).length / aSetups.length) * 100) : 0;

  const tradingDays = Array.from(new Set(allTrades.map((t) => t.date))).sort();
  let streak = 0;
  for (let i = tradingDays.length - 1; i >= 0; i -= 1) {
    const tradesForDate = allTrades.filter((t) => t.date === tradingDays[i]);
    const hadRuleBreak = tradesForDate.some((t) => !t.followedRules);
    if (hadRuleBreak) break;
    streak += 1;
  }

  const status = dayStatus(state, dayTrades, { ...day, dayLocked: lockActive });

  const topMistakes = Object.entries(
    allTrades.reduce((acc, trade) => {
      const key = trade.mistake?.trim();
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const allKnownDates = Array.from(new Set([todayKey(), ...Object.keys(state.daily || {}), ...state.trades.map((t) => t.date)])).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  const selectedDateIndex = allKnownDates.indexOf(selectedDate);
  const previousDate = selectedDateIndex >= 0 && selectedDateIndex < allKnownDates.length - 1 ? allKnownDates[selectedDateIndex + 1] : "";
  const nextDate = selectedDateIndex > 0 ? allKnownDates[selectedDateIndex - 1] : "";

  const calendarDays = useMemo(() => {
    const focus = new Date(`${selectedDate}T12:00:00`);
    const year = focus.getFullYear();
    const month = focus.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const start = new Date(firstOfMonth);
    start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const entryDay = state.daily?.[key] || baseDay();
      const entryTrades = state.trades.filter((t) => t.date === key);
      const summary = getDaySummary(entryDay, entryTrades);
      return {
        key,
        dayNumber: date.getDate(),
        inMonth: date.getMonth() === month,
        isSelected: key === selectedDate,
        isToday: key === todayKey(),
        summary,
        locked: isDayLocked(entryDay),
      };
    });
  }, [selectedDate, state.daily, state.trades]);

  const statCards = [
    statCard("Total R", `${totalR >= 0 ? "+" : ""}${totalR.toFixed(2)}R`, "All logged trades", CircleDollarSign),
    statCard("Win rate", `${winRate}%`, `${wins} wins · ${losses} losses`, TrendingUp),
    statCard("Expectancy", `${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(2)}R`, "Average R per trade", BarChart3),
    statCard("Rule adherence", `${ruleAdherence}%`, `${ruleBreaks} rule breaks`, ShieldAlert),
    statCard("Clean-day streak", `${streak}`, "Days without rule breaks", Flame),
    statCard("Last 7 days", `${lastSevenR >= 0 ? "+" : ""}${lastSevenR.toFixed(2)}R`, "Recent performance", Activity),
  ];

  function clearHoldVisuals() {
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    holdIntervalRef.current = null;
    holdTimeoutRef.current = null;
  }

  function beginHold(list, id) {
    clearHoldVisuals();
    setHoldState({ list, id, progress: 0 });
    const start = Date.now();
    holdIntervalRef.current = setInterval(() => {
      const progress = Math.min(1, (Date.now() - start) / HOLD_TO_DRAG_MS);
      setHoldState({ list, id, progress });
    }, 16);
    holdTimeoutRef.current = setTimeout(() => {
      clearHoldVisuals();
      setHoldState({ list, id, progress: 1 });
      setDragReady({ list, id });
    }, HOLD_TO_DRAG_MS);
  }

  function cancelHold(list, id) {
    clearHoldVisuals();
    setHoldState((current) => (current.list === list && current.id === id ? { list: "", id: "", progress: 0 } : current));
  }

  function isHoldActive(list, id) {
    return holdState.list === list && holdState.id === id;
  }

  function isDragReady(list, id) {
    return dragReady.list === list && dragReady.id === id;
  }

  function getHoldScale(list, id) {
    if (!isHoldActive(list, id)) return 1;
    return 1 - holdState.progress * 0.045;
  }

  function reorderList(listName, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    setState((prev) => {
      if (listName === "checklist") {
        const source = prev.daily?.[selectedDate]?.checklist || [];
        return {
          ...prev,
          daily: {
            ...prev.daily,
            [selectedDate]: {
              ...(prev.daily?.[selectedDate] || baseDay()),
              checklist: reorderById(source, fromId, toId),
            },
          },
        };
      }
      if (listName === "links") {
        return { ...prev, links: reorderById(prev.links || [], fromId, toId) };
      }
      if (listName === "reminders") {
        return { ...prev, reminders: reorderById(prev.reminders || [], fromId, toId) };
      }
      return prev;
    });
  }

  function handleDragStart(list, id, event) {
    if (!isDragReady(list, id)) {
      event.preventDefault();
      return;
    }
    setDraggingItem({ list, id });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${list}:${id}`);
  }

  function handleDragEnd() {
    setDraggingItem({ list: "", id: "" });
    setDragReady({ list: "", id: "" });
    setHoldState({ list: "", id: "", progress: 0 });
    clearHoldVisuals();
  }

  function handleDrop(list, targetId, event) {
    event.preventDefault();
    const sourceId = draggingItem.list === list ? draggingItem.id : dragReady.list === list ? dragReady.id : "";
    reorderList(list, sourceId, targetId);
    handleDragEnd();
  }

  function handleToolOpen(url, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    try {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        window.location.assign(url);
      }
    } catch {
      window.location.assign(url);
    }
  }

  function updateDayField(field, value) {
    setState((prev) => ensureDayShape(prev, selectedDate));
    setState((prev) => ({
      ...prev,
      daily: {
        ...prev.daily,
        [selectedDate]: {
          ...prev.daily[selectedDate],
          [field]: value,
        },
      },
    }));
  }

  function toggleChecklist(id) {
    if (lockActive) return;
    if (isDragReady("checklist", id)) {
      setDragReady({ list: "", id: "" });
      setHoldState({ list: "", id: "", progress: 0 });
      return;
    }
    setState((prev) => ({
      ...ensureDayShape(prev, selectedDate),
      daily: {
        ...prev.daily,
        [selectedDate]: {
          ...prev.daily[selectedDate],
          checklist: prev.daily[selectedDate].checklist.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)),
        },
      },
    }));
  }

  function addChecklistItem() {
    if (!newChecklistItem.trim() || lockActive) return;
    setState((prev) => ({
      ...ensureDayShape(prev, selectedDate),
      daily: {
        ...prev.daily,
        [selectedDate]: {
          ...prev.daily[selectedDate],
          checklist: [
            ...prev.daily[selectedDate].checklist,
            { id: crypto.randomUUID(), text: newChecklistItem.trim(), checked: false },
          ],
        },
      },
    }));
    setNewChecklistItem("");
  }

  function removeChecklistItem(id) {
    if (lockActive) return;
    setState((prev) => ({
      ...ensureDayShape(prev, selectedDate),
      daily: {
        ...prev.daily,
        [selectedDate]: {
          ...prev.daily[selectedDate],
          checklist: prev.daily[selectedDate].checklist.filter((item) => item.id !== id),
        },
      },
    }));
  }

  function addTrade() {
    if (!tradeForm.market.trim() || lockActive) return;
    const trade = { ...tradeForm, id: crypto.randomUUID(), resultR: tradeForm.resultR === "" ? "0" : tradeForm.resultR };
    setState((prev) => ({ ...prev, trades: [trade, ...prev.trades] }));
    setTradeForm((prev) => ({ ...prev, resultR: "", thesis: "", mistake: "", tags: "", screenshotUrl: "", followedRules: true, time: "" }));
  }

  function deleteTrade(id) {
    if (lockActive) return;
    setState((prev) => ({ ...prev, trades: prev.trades.filter((trade) => trade.id !== id) }));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `discipline-trader-toolkit-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target?.result || "{}"));
        setState({
          rules: { ...defaultRules, ...(parsed.rules || {}) },
          links: Array.isArray(parsed.links) ? parsed.links : starterLinks,
          reminders: Array.isArray(parsed.reminders) && parsed.reminders.length ? parsed.reminders : cloneReminders(),
          daily: parsed.daily || { [todayKey()]: baseDay() },
          trades: Array.isArray(parsed.trades) ? parsed.trades : [],
        });
      } catch {
        alert("Could not import file.");
      }
    };
    reader.readAsText(file);
  }

  function resetSelectedDay() {
    setState((prev) => ({
      ...prev,
      daily: { ...prev.daily, [selectedDate]: baseDay() },
      trades: prev.trades.filter((t) => t.date !== selectedDate),
    }));
  }

  function applyDayLock() {
    let untilValue = endOfDayLocalInputValue();
    if (pendingLockMode === "custom") {
      const now = new Date();
      const hours = Math.max(0, toNum(pendingLockHours, 0));
      const minutes = Math.max(0, toNum(pendingLockMinutes, 0));
      const until = new Date(now.getTime() + (hours * 60 + minutes) * 60 * 1000);
      untilValue = formatLocalDateTimeInput(until);
    }
    setState((prev) => ({
      ...prev,
      daily: {
        ...prev.daily,
        [selectedDate]: { ...(prev.daily?.[selectedDate] || baseDay()), dayLocked: true, dayLockUntil: untilValue },
      },
    }));
  }

  function unlockDay() {
    setState((prev) => ({
      ...prev,
      daily: {
        ...prev.daily,
        [selectedDate]: { ...(prev.daily?.[selectedDate] || baseDay()), dayLocked: false, dayLockUntil: "" },
      },
    }));
  }

  function addTool() {
    if (!newTool.name.trim() || !newTool.url.trim()) return;
    setState((prev) => ({
      ...prev,
      links: [
        ...prev.links,
        { id: crypto.randomUUID(), name: newTool.name.trim(), url: newTool.url.trim(), note: newTool.note.trim() },
      ],
    }));
    setNewTool({ name: "", url: "", note: "" });
  }

  function updateTool(id, field, value) {
    setState((prev) => ({
      ...prev,
      links: prev.links.map((link) => (link.id === id ? { ...link, [field]: value } : link)),
    }));
  }

  function removeTool(id) {
    setState((prev) => ({ ...prev, links: prev.links.filter((link) => link.id !== id) }));
  }

  function addReminder() {
    if (!newReminder.trim()) return;
    setState((prev) => ({ ...prev, reminders: [...(prev.reminders || []), { id: crypto.randomUUID(), text: newReminder.trim() }] }));
    setNewReminder("");
  }

  function updateReminder(id, value) {
    setState((prev) => ({
      ...prev,
      reminders: (prev.reminders || []).map((item) => (item.id === id ? { ...item, text: value } : item)),
    }));
  }

  function removeReminder(id) {
    setState((prev) => ({ ...prev, reminders: (prev.reminders || []).filter((item) => item.id !== id) }));
  }

  function toneClasses(tone) {
    if (tone === "red") return "bg-red-500/15 text-red-200 border-red-400/20";
    if (tone === "amber") return "bg-amber-500/15 text-amber-100 border-amber-300/20";
    return "bg-emerald-500/15 text-emerald-100 border-emerald-300/20";
  }

  return (
    <div className="min-h-screen bg-[#06080d] text-white">
      <div className="mx-auto max-w-7xl px-4 py-5 md:px-6 lg:px-8">
        <div className="mb-6 grid gap-4 xl:grid-cols-[1.35fr_0.8fr] xl:items-stretch">
          <Card className="overflow-hidden rounded-[2rem] border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_35%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_30%),linear-gradient(180deg,rgba(17,24,39,0.92),rgba(8,12,18,0.98))] shadow-2xl shadow-black/30">
            <CardContent className="relative p-4 md:p-5 h-full">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_30%,transparent_60%,rgba(255,255,255,0.03))]" />
              <div className="relative z-10 flex h-full flex-col gap-4">
                <div className="max-w-[36rem]">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full border border-emerald-300/20 bg-emerald-400/20 px-3 py-1 text-emerald-100 hover:bg-emerald-400/20">{state.rules.propFirm} discipline mode</Badge>
                    <Badge className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-zinc-100 hover:bg-white/10">{state.rules.accountSize}</Badge>
                    <Badge className="rounded-full border border-cyan-300/20 bg-cyan-400/15 px-3 py-1 text-cyan-100 hover:bg-cyan-400/15">2:1 default process</Badge>
                  </div>
                  <h1 className="text-3xl font-medium tracking-tight leading-[0.92] text-white md:text-[3.1rem] lg:text-[3.25rem]">
                    <span className="block">Discipline Trader</span>
                    <span className="block">Toolkit</span>
                  </h1>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_370px] lg:items-start">
                  <p className="max-w-[34rem] text-[0.92rem] leading-[1.7] text-zinc-200 md:text-[0.96rem] lg:pt-1">
                    A clean daily system for staying calm, tracking rules, journaling fast, and making it painfully obvious when you start drifting. Built for your own use, but flexible enough for anyone who wants structure.
                  </p>

                  <div className="justify-self-end lg:pr-4 xl:pr-5">
                    <div className="grid w-full max-w-[370px] gap-2 sm:grid-cols-2 lg:grid-cols-2">
                      <Button onClick={exportData} className={softButtonClasses()}>
                        <ArrowDownToLine className="mr-2 h-4 w-4" /> Export
                      </Button>
                      <label className={`${softButtonClasses("ghost")} inline-flex cursor-pointer items-center justify-center px-4 py-2 text-sm`}>
                        <ArrowUpFromLine className="mr-2 h-4 w-4" /> Import
                        <input type="file" accept="application/json" className="hidden" onChange={importData} />
                      </label>
                      {lockActive ? (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button className={softButtonClasses("ghost")}>
                              <Lock className="mr-2 h-4 w-4" /> Unlock day
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                            <DialogHeader><DialogTitle>Unlock this day?</DialogTitle></DialogHeader>
                            <p className="text-sm leading-6 text-zinc-300">This reopens the selected date so you can edit and continue using it.</p>
                            <Dialog>
                              <DialogTrigger asChild><Button className={softButtonClasses()}>Continue</Button></DialogTrigger>
                              <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                                <DialogHeader><DialogTitle>Final unlock confirmation</DialogTitle></DialogHeader>
                                <p className="text-sm leading-6 text-zinc-300">Are you sure you want to unlock {formatDisplayDate(selectedDate)}?</p>
                                <Button onClick={unlockDay} className={softButtonClasses()}>Yes, unlock day</Button>
                              </DialogContent>
                            </Dialog>
                          </DialogContent>
                        </Dialog>
                      ) : (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button className={softButtonClasses("ghost")}>
                              <Lock className="mr-2 h-4 w-4" /> Lock day
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                            <DialogHeader><DialogTitle>Lock this day</DialogTitle></DialogHeader>
                            <p className="text-sm leading-6 text-zinc-300">Default lock is for the rest of the day. You can switch to a custom hour and minute lock if needed.</p>
                            <div className="space-y-4">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <button type="button" onClick={() => setPendingLockMode("restOfDay")} className={`rounded-2xl border px-4 py-4 text-left transition ${pendingLockMode === "restOfDay" ? "border-emerald-300/20 bg-emerald-400/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                                  <p className="font-medium text-white">Rest of day</p>
                                  <p className="mt-1 text-sm text-zinc-400">Locks until 11:59 PM today.</p>
                                </button>
                                <button type="button" onClick={() => setPendingLockMode("custom")} className={`rounded-2xl border px-4 py-4 text-left transition ${pendingLockMode === "custom" ? "border-emerald-300/20 bg-emerald-400/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                                  <p className="font-medium text-white">Custom timer</p>
                                  <p className="mt-1 text-sm text-zinc-400">Pick hours and minutes from now.</p>
                                </button>
                              </div>
                              {pendingLockMode === "custom" ? (
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div>
                                    <p className="mb-2 text-sm text-zinc-300">Hours</p>
                                    <Input value={pendingLockHours} onChange={(e) => setPendingLockHours(e.target.value)} className="rounded-2xl border-white/10 bg-white/5 text-white" />
                                  </div>
                                  <div>
                                    <p className="mb-2 text-sm text-zinc-300">Minutes</p>
                                    <Input value={pendingLockMinutes} onChange={(e) => setPendingLockMinutes(e.target.value)} className="rounded-2xl border-white/10 bg-white/5 text-white" />
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <Dialog>
                              <DialogTrigger asChild><Button className={softButtonClasses()}>Continue</Button></DialogTrigger>
                              <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                                <DialogHeader><DialogTitle>Final lock confirmation</DialogTitle></DialogHeader>
                                <p className="text-sm leading-6 text-zinc-300">{pendingLockMode === "restOfDay" ? `Lock ${formatDisplayDate(selectedDate)} for the rest of today?` : `Lock ${formatDisplayDate(selectedDate)} for ${Math.max(0, toNum(pendingLockHours, 0))} hour(s) and ${Math.max(0, toNum(pendingLockMinutes, 0))} minute(s)?`}</p>
                                <Button onClick={applyDayLock} className={softButtonClasses()}>Yes, lock day</Button>
                              </DialogContent>
                            </Dialog>
                          </DialogContent>
                        </Dialog>
                      )}
                      <Dialog>
                        <DialogTrigger asChild><Button className={softButtonClasses("ghost")}><RefreshCw className="mr-2 h-4 w-4" /> Reset day</Button></DialogTrigger>
                        <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                          <DialogHeader><DialogTitle>Reset the selected day?</DialogTitle></DialogHeader>
                          <p className="text-sm leading-6 text-zinc-300">This clears the checklist, notes, review, and all trades for the current date.</p>
                          <Dialog>
                            <DialogTrigger asChild><Button className={softButtonClasses("danger")}>Continue</Button></DialogTrigger>
                            <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                              <DialogHeader><DialogTitle>Final reset confirmation</DialogTitle></DialogHeader>
                              <p className="text-sm leading-6 text-zinc-300">Are you sure you want to erase everything for {formatDisplayDate(selectedDate)}?</p>
                              <Button onClick={resetSelectedDay} className={softButtonClasses("danger")}>Yes, reset this day</Button>
                            </DialogContent>
                          </Dialog>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1.05fr_1.05fr_1.35fr]">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm min-h-[72px]">
                    <p className="text-[0.66rem] uppercase tracking-[0.17em] text-zinc-400">Focus markets</p>
                    <p className="mt-2 text-[0.86rem] font-medium leading-6 text-white">{state.rules.focusMarkets}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm min-h-[72px]">
                    <p className="text-[0.66rem] uppercase tracking-[0.17em] text-zinc-400">Session</p>
                    <p className="mt-2 text-[0.86rem] font-medium leading-6 text-white">{state.rules.session}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm min-h-[72px]">
                    <p className="text-[0.66rem] uppercase tracking-[0.17em] text-zinc-400">Primary setup</p>
                    <p className="mt-2 text-[0.86rem] font-medium leading-6 text-white">{state.rules.primarySetup}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="h-full min-h-[205px] rounded-[2rem] border-white/10 bg-white/[0.04] shadow-2xl shadow-black/25 backdrop-blur-sm">
            <CardContent className="p-4 md:p-5 h-full flex flex-col">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[0.66rem] uppercase tracking-[0.17em] text-zinc-400">Trading day</p>
                  <Input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setTradeForm((prev) => ({ ...prev, date: e.target.value })); }} className="mt-3 rounded-2xl border-white/10 bg-white/5 text-white" />
                </div>
                <div className={`rounded-2xl border px-3 py-2 text-sm font-medium ${toneClasses(status.tone)}`}>{status.label}</div>
              </div>
              <Separator className="my-4 bg-white/10" />
              <div className="space-y-3 flex-1 flex flex-col">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-zinc-300">Day result</p>
                      <p className="mt-1 text-2xl font-semibold text-white">{dayR >= 0 ? "+" : ""}{dayR.toFixed(2)}R</p>
                    </div>
                    <Badge className="rounded-full border border-white/10 bg-white/10 text-zinc-100 hover:bg-white/10">{dayTrades.length}/{state.rules.maxTradesPerDay} trades</Badge>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-zinc-300">Daily flow completion</p>
                    <p className="text-sm font-medium text-white">{dailyProgress}%</p>
                  </div>
                  <Progress value={dailyProgress} className="mt-3 h-3 bg-white/10" />
                  <p className="mt-3 text-sm leading-6 text-zinc-400">{status.reason}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm text-zinc-300">Checklist</p>
                    <p className="mt-1 text-xl font-semibold text-white">{checklistPct}%</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm text-zinc-300">Losses used</p>
                    <p className="mt-1 text-xl font-semibold text-white">{dayLosses}/{state.rules.maxLossesPerDay}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {statCards.map(({ label, value, sub, Icon }) => (
            <Card key={label} className="rounded-[1.6rem] border-white/10 bg-white/[0.04] backdrop-blur-sm min-h-[124px]">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">{label}</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
                    <p className="mt-1 text-sm text-zinc-400">{sub}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><Icon className="h-5 w-5 text-zinc-100" /></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="command" className="mt-6">
          <TabsList className="grid w-full grid-cols-2 gap-2 rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-2 md:grid-cols-4 xl:grid-cols-7 min-h-[72px]">
            <TabsTrigger value="command" className="rounded-2xl">Command</TabsTrigger>
            <TabsTrigger value="prep" className="rounded-2xl">Prep</TabsTrigger>
            <TabsTrigger value="journal" className="rounded-2xl">Journal</TabsTrigger>
            <TabsTrigger value="review" className="rounded-2xl">Review</TabsTrigger>
            <TabsTrigger value="calendar" className="rounded-2xl">Calendar</TabsTrigger>
            <TabsTrigger value="playbook" className="rounded-2xl">Playbook</TabsTrigger>
            <TabsTrigger value="tools" className="rounded-2xl">Tools</TabsTrigger>
          </TabsList>

          <TabsContent value="command" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><Sparkles className="h-5 w-5 text-emerald-300" /> Daily command center</CardTitle>
                  <CardDescription className="text-zinc-400">One screen to keep you honest before, during, and after market.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-2 flex items-center gap-2 text-zinc-200"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Premarket</div>
                      <p className="text-sm leading-6 text-zinc-400">Plan levels, bias, invalidation, news windows, and size.</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-2 flex items-center gap-2 text-zinc-200"><Zap className="h-4 w-4 text-cyan-300" /> Execution</div>
                      <p className="text-sm leading-6 text-zinc-400">Only A setups. Respect stop. Respect trade cap.</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-2 flex items-center gap-2 text-zinc-200"><NotebookPen className="h-4 w-4 text-violet-300" /> Review</div>
                      <p className="text-sm leading-6 text-zinc-400">Journal fast while memory is fresh and write one repeatable lesson.</p>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm text-zinc-300">Premarket plan</p>
                    <Textarea value={day.premarketPlan} onChange={(e) => updateDayField("premarketPlan", e.target.value)} placeholder="Bias, key levels, news times, setup trigger, invalidation, no-trade conditions..." className="min-h-[160px] rounded-[1.5rem] border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} />
                  </div>
                  <div>
                    <p className="mb-2 text-sm text-zinc-300">Live execution notes</p>
                    <Textarea value={day.executionNotes} onChange={(e) => updateDayField("executionNotes", e.target.value)} placeholder="What the market is doing right now, what changed, why you are waiting, why you passed..." className="min-h-[120px] rounded-[1.5rem] border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} />
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4">
                <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white"><Target className="h-5 w-5 text-emerald-300" /> Today’s hard rules</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm leading-6 text-zinc-300">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">• Max daily loss: <span className="font-medium text-white">{state.rules.maxDailyLossR}</span></div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">• Trade cap: <span className="font-medium text-white">{state.rules.maxTradesPerDay}</span></div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">• Setup: <span className="font-medium text-white">{state.rules.primarySetup}</span></div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">• Stop rule: <span className="font-medium text-white">{state.rules.stopRule}</span></div>
                  </CardContent>
                </Card>

                <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-white"><Brain className="h-5 w-5 text-cyan-300" /> Calm reminders</CardTitle>
                      </div>
                      <Button size="sm" className={softButtonClasses("ghost")} onClick={() => setEditingReminders((v) => !v)}>
                        {editingReminders ? <><Check className="mr-2 h-4 w-4" /> Save</> : <><Pencil className="mr-2 h-4 w-4" /> Edit</>}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm leading-6 text-zinc-300">
                    {reminders.map((item) => (
                      <div
                        key={item.id}
                        draggable={editingReminders}
                        onPointerDown={() => editingReminders && beginHold("reminders", item.id)}
                        onPointerUp={() => editingReminders && cancelHold("reminders", item.id)}
                        onPointerLeave={() => editingReminders && cancelHold("reminders", item.id)}
                        onDragStart={(e) => handleDragStart("reminders", item.id, e)}
                        onDragOver={(e) => editingReminders && e.preventDefault()}
                        onDrop={(e) => editingReminders && handleDrop("reminders", item.id, e)}
                        onDragEnd={handleDragEnd}
                        className={`rounded-2xl border border-white/10 bg-white/5 p-4 transition ${draggingItem.list === "reminders" && draggingItem.id === item.id ? "opacity-60" : ""}`}
                        style={{ transform: `scale(${getHoldScale("reminders", item.id)})` }}
                      >
                        {editingReminders ? (
                          <div className="space-y-3">
                            <Textarea value={item.text} onChange={(e) => updateReminder(item.id, e.target.value)} className="min-h-[74px] rounded-2xl border-white/10 bg-black/10 text-white" />
                            <div className="flex items-center justify-between gap-2">
                              <HoldHint active={isDragReady("reminders", item.id)} />
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button size="sm" className={softButtonClasses("ghost")}><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
                                </DialogTrigger>
                                <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                                  <DialogHeader><DialogTitle>Delete reminder?</DialogTitle></DialogHeader>
                                  <p className="text-sm text-zinc-300">This reminder will be removed.</p>
                                  <Button className={softButtonClasses("danger")} onClick={() => removeReminder(item.id)}>Yes, delete reminder</Button>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </div>
                        ) : (
                          <div>{item.text}</div>
                        )}
                      </div>
                    ))}
                    {editingReminders ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-3">
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <Input value={newReminder} onChange={(e) => setNewReminder(e.target.value)} placeholder="Add new reminder" className="rounded-2xl border-white/10 bg-black/10 text-white" />
                          <Button className={softButtonClasses()} onClick={addReminder}><Plus className="mr-2 h-4 w-4" /> Add</Button>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="prep" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> Premarket checklist</CardTitle>
                  <CardDescription className="text-zinc-400">Keep it interactive and custom so this can work for you or anyone else using it.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {day.checklist.map((item) => {
                      const ready = isDragReady("checklist", item.id);
                      return (
                        <div
                          key={item.id}
                          draggable={!lockActive}
                          onPointerDown={() => !lockActive && beginHold("checklist", item.id)}
                          onPointerUp={() => !lockActive && cancelHold("checklist", item.id)}
                          onPointerLeave={() => !lockActive && cancelHold("checklist", item.id)}
                          onDragStart={(e) => handleDragStart("checklist", item.id, e)}
                          onDragOver={(e) => !lockActive && e.preventDefault()}
                          onDrop={(e) => !lockActive && handleDrop("checklist", item.id, e)}
                          onDragEnd={handleDragEnd}
                          className={`group rounded-[1.35rem] border transition-all ${item.checked ? "border-emerald-300/20 bg-emerald-400/10" : "border-white/10 bg-white/5 hover:bg-white/8"} ${draggingItem.list === "checklist" && draggingItem.id === item.id ? "opacity-60" : ""}`}
                          style={{ transform: `scale(${getHoldScale("checklist", item.id)})` }}
                        >
                          <button
                            type="button"
                            onClick={() => toggleChecklist(item.id)}
                            disabled={lockActive}
                            className="flex min-h-[74px] w-full items-center gap-3 px-4 py-3 text-left"
                          >
                            <Checkbox checked={item.checked} className="pointer-events-none" />
                            <span className="flex-1 text-sm leading-5 text-white">{item.text}</span>
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  size="icon"
                                  className={`${softButtonClasses("ghost")} h-8 w-8 shrink-0`}
                                  onClick={(e) => e.stopPropagation()}
                                  disabled={lockActive}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                                <DialogHeader><DialogTitle>Delete checklist item?</DialogTitle></DialogHeader>
                                <p className="text-sm text-zinc-300">This checklist item will be removed.</p>
                                <Button className={softButtonClasses("danger")} onClick={() => removeChecklistItem(item.id)}>Yes, delete item</Button>
                              </DialogContent>
                            </Dialog>
                          </button>
                          {ready ? (
                            <div className="px-4 pb-3">
                              <HoldHint active={ready} />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <Input value={newChecklistItem} onChange={(e) => setNewChecklistItem(e.target.value)} placeholder="Add custom checklist item" className="rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} />
                    <Button className={softButtonClasses()} onClick={addChecklistItem} disabled={lockActive}><Plus className="mr-2 h-4 w-4" /> Add item</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><Flag className="h-5 w-5 text-violet-300" /> Session prep box</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="mb-2 text-sm text-zinc-300">Mood</p>
                    <Select value={day.mood} onValueChange={(value) => updateDayField("mood", value)} disabled={lockActive}>
                      <SelectTrigger className="rounded-2xl border-white/10 bg-white/5 text-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Calm">Calm</SelectItem>
                        <SelectItem value="Neutral">Neutral</SelectItem>
                        <SelectItem value="Frustrated">Frustrated</SelectItem>
                        <SelectItem value="FOMO">FOMO</SelectItem>
                        <SelectItem value="Overconfident">Overconfident</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Default target</p>
                      <p className="mt-2 text-lg font-medium text-white">{state.rules.dailyGoalR}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Risk per trade</p>
                      <p className="mt-2 text-lg font-medium text-white">{state.rules.maxRiskPerTradeR}</p>
                    </div>
                  </div>
                  <div className="rounded-[1.4rem] border border-amber-300/15 bg-amber-400/10 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-200" />
                      <div>
                        <p className="text-sm font-medium text-amber-50">Tilt prevention</p>
                        <p className="mt-1 text-sm leading-6 text-amber-100/80">If your mood is anything besides calm or neutral, reduce size mentally or skip marginal trades entirely.</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-medium text-white">Great use for other traders too</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">Anyone can customize the checklist, rules, links, and journal flow without breaking the system. That makes this usable as a template, not just a personal page.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="journal" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><NotebookPen className="h-5 w-5 text-emerald-300" /> Quick trade journal</CardTitle>
                  <CardDescription className="text-zinc-400">Fast to fill out so you actually use it.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div><p className="mb-2 text-sm text-zinc-300">Date</p><Input type="date" value={tradeForm.date} onChange={(e) => setTradeForm({ ...tradeForm, date: e.target.value })} className="rounded-2xl border-white/10 bg-white/5 text-white" disabled={lockActive} /></div>
                    <div><p className="mb-2 text-sm text-zinc-300">Time</p><Input type="time" value={tradeForm.time} onChange={(e) => setTradeForm({ ...tradeForm, time: e.target.value })} className="rounded-2xl border-white/10 bg-white/5 text-white" disabled={lockActive} /></div>
                    <div><p className="mb-2 text-sm text-zinc-300">Market</p><Input value={tradeForm.market} onChange={(e) => setTradeForm({ ...tradeForm, market: e.target.value })} className="rounded-2xl border-white/10 bg-white/5 text-white" disabled={lockActive} /></div>
                    <div>
                      <p className="mb-2 text-sm text-zinc-300">Direction</p>
                      <Select value={tradeForm.direction} onValueChange={(value) => setTradeForm({ ...tradeForm, direction: value })} disabled={lockActive}>
                        <SelectTrigger className="rounded-2xl border-white/10 bg-white/5 text-white"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="Long">Long</SelectItem><SelectItem value="Short">Short</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="mb-2 text-sm text-zinc-300">Quality</p>
                      <Select value={tradeForm.quality} onValueChange={(value) => setTradeForm({ ...tradeForm, quality: value })} disabled={lockActive}>
                        <SelectTrigger className="rounded-2xl border-white/10 bg-white/5 text-white"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="A">A</SelectItem><SelectItem value="B">B</SelectItem><SelectItem value="C">C</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><p className="mb-2 text-sm text-zinc-300">Result (R)</p><Input value={tradeForm.resultR} onChange={(e) => setTradeForm({ ...tradeForm, resultR: e.target.value })} placeholder="2, -1, 0.5" className="rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} /></div>
                    <div><p className="mb-2 text-sm text-zinc-300">Planned RR</p><Input value={tradeForm.plannedRR} onChange={(e) => setTradeForm({ ...tradeForm, plannedRR: e.target.value })} className="rounded-2xl border-white/10 bg-white/5 text-white" disabled={lockActive} /></div>
                    <div><p className="mb-2 text-sm text-zinc-300">Mistake type</p><Input value={tradeForm.mistake} onChange={(e) => setTradeForm({ ...tradeForm, mistake: e.target.value })} placeholder="Chased, entered early, moved stop..." className="rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} /></div>
                    <div className="md:col-span-2"><p className="mb-2 text-sm text-zinc-300">Setup name</p><Input value={tradeForm.setup} onChange={(e) => setTradeForm({ ...tradeForm, setup: e.target.value })} className="rounded-2xl border-white/10 bg-white/5 text-white" disabled={lockActive} /></div>
                  </div>
                  <div><p className="mb-2 text-sm text-zinc-300">Trade thesis</p><Textarea value={tradeForm.thesis} onChange={(e) => setTradeForm({ ...tradeForm, thesis: e.target.value })} placeholder="Why did this trade exist? What did you see?" className="min-h-[120px] rounded-[1.4rem] border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} /></div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div><p className="mb-2 text-sm text-zinc-300">Tags</p><Input value={tradeForm.tags} onChange={(e) => setTradeForm({ ...tradeForm, tags: e.target.value })} placeholder="trend day, open drive, news fade..." className="rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} /></div>
                    <div><p className="mb-2 text-sm text-zinc-300">Screenshot link</p><Input value={tradeForm.screenshotUrl} onChange={(e) => setTradeForm({ ...tradeForm, screenshotUrl: e.target.value })} placeholder="Optional" className="rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} /></div>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"><Checkbox checked={tradeForm.followedRules} onCheckedChange={(value) => setTradeForm({ ...tradeForm, followedRules: Boolean(value) })} disabled={lockActive} /><span className="text-sm text-white">This trade followed all rules</span></div>
                  <Button onClick={addTrade} className={`${softButtonClasses()} w-full`} disabled={lockActive}><Save className="mr-2 h-4 w-4" /> Save trade</Button>
                </CardContent>
              </Card>

              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><CalendarDays className="h-5 w-5 text-cyan-300" /> Trades for {selectedDate}</CardTitle>
                  <CardDescription className="text-zinc-400">Clean cards with readable tags and rule-break visibility.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {dayTrades.length === 0 ? <div className="rounded-[1.4rem] border border-dashed border-white/10 bg-white/5 p-8 text-center text-zinc-400">No trades logged for this date yet.</div> : dayTrades.map((trade) => (
                      <div key={trade.id} className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 transition hover:bg-white/[0.07]">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">{trade.market}</Badge>
                              <Badge className="rounded-full bg-cyan-400/15 text-cyan-100 hover:bg-cyan-400/15">{trade.direction}</Badge>
                              <Badge className="rounded-full bg-violet-400/15 text-violet-100 hover:bg-violet-400/15">{trade.quality} setup</Badge>
                              <Badge className={`rounded-full ${toNum(trade.resultR) >= 0 ? "bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/15" : "bg-red-400/15 text-red-100 hover:bg-red-400/15"}`}>{toNum(trade.resultR) >= 0 ? "+" : ""}{trade.resultR}R</Badge>
                              {trade.time ? <Badge className="rounded-full bg-white/10 text-zinc-200 hover:bg-white/10"><Clock3 className="mr-1 h-3.5 w-3.5" />{trade.time}</Badge> : null}
                            </div>
                            <p className="mt-3 text-lg font-medium text-white">{trade.setup}</p>
                            <p className="mt-1 text-sm text-zinc-400">Planned RR: {trade.plannedRR}:1</p>
                            {trade.thesis ? <p className="mt-3 text-sm leading-6 text-zinc-300">{trade.thesis}</p> : null}
                            <div className="mt-3 flex flex-wrap gap-2">{(trade.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => <Badge key={`${trade.id}-${tag}`} className="rounded-full border border-white/10 bg-white/10 text-zinc-100 hover:bg-white/10">{tag}</Badge>)}</div>
                          </div>
                          <div className="flex shrink-0 flex-col gap-2 lg:items-end">
                            <Badge className={`rounded-full ${trade.followedRules ? "bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/15" : "bg-amber-400/20 text-amber-100 hover:bg-amber-400/20"}`}>{trade.followedRules ? "Rules followed" : "Rule break"}</Badge>
                            {trade.mistake ? <p className="max-w-[240px] text-right text-sm text-zinc-400">Mistake: {trade.mistake}</p> : null}
                            {trade.screenshotUrl ? <a href={trade.screenshotUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-sm text-zinc-200 underline underline-offset-4"><Link2 className="mr-1 h-4 w-4" /> Open screenshot</a> : null}
                            <Dialog>
                              <DialogTrigger asChild><Button size="sm" className={softButtonClasses("ghost")} disabled={lockActive}><Trash2 className="mr-2 h-4 w-4" /> Delete</Button></DialogTrigger>
                              <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                                <DialogHeader><DialogTitle>Delete trade?</DialogTitle></DialogHeader>
                                <p className="text-sm text-zinc-300">This trade entry will be removed.</p>
                                <Button className={softButtonClasses("danger")} onClick={() => deleteTrade(trade.id)}>Yes, delete trade</Button>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="review" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><Trophy className="h-5 w-5 text-emerald-300" /> Daily review</CardTitle>
                  <CardDescription className="text-zinc-400">Simple end-of-day journaling that still captures what matters.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div><p className="mb-2 text-sm text-zinc-300">Review</p><Textarea value={day.review} onChange={(e) => updateDayField("review", e.target.value)} placeholder="What went well, what hurt, what did the market reward, what did it punish?" className="min-h-[160px] rounded-[1.5rem] border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} /></div>
                  <div><p className="mb-2 text-sm text-zinc-300">One lesson for tomorrow</p><Textarea value={day.lesson} onChange={(e) => updateDayField("lesson", e.target.value)} placeholder="One thing to repeat or fix tomorrow." className="min-h-[100px] rounded-[1.5rem] border-white/10 bg-white/5 text-white placeholder:text-zinc-500" disabled={lockActive} /></div>
                </CardContent>
              </Card>

              <div className="grid gap-4">
                <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-white"><Target className="h-5 w-5 text-cyan-300" /> Performance breakdown</CardTitle></CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-400">A-setup win rate</p><p className="mt-2 text-2xl font-semibold text-white">{aWinRate}%</p></div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Average winner</p><p className="mt-2 text-2xl font-semibold text-white">{avgWinner >= 0 ? "+" : ""}{avgWinner.toFixed(2)}R</p></div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Average loser</p><p className="mt-2 text-2xl font-semibold text-white">{avgLoser.toFixed(2)}R</p></div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Breakeven trades</p><p className="mt-2 text-2xl font-semibold text-white">{breakEvenTrades}</p></div>
                  </CardContent>
                </Card>
                <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-white"><BookOpen className="h-5 w-5 text-violet-300" /> Repeating mistakes</CardTitle></CardHeader>
                  <CardContent>
                    {topMistakes.length === 0 ? <div className="rounded-[1.4rem] border border-dashed border-white/10 bg-white/5 p-6 text-zinc-400">No mistake patterns yet. That is either good, or you need to be more honest in your journal.</div> : <div className="space-y-3">{topMistakes.map(([mistake, count]) => <div key={mistake} className="flex items-center justify-between rounded-[1.3rem] border border-white/10 bg-white/5 p-4"><span className="text-sm text-white">{mistake}</span><Badge className="rounded-full bg-white/10 text-zinc-100 hover:bg-white/10">{count}</Badge></div>)}</div>}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="calendar" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><CalendarDays className="h-5 w-5 text-emerald-300" /> Daily tracker calendar</CardTitle>
                  <CardDescription className="text-zinc-400">Click a day to jump straight into its checklist, journal, review, and stats.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-zinc-300">Viewing month</p>
                      <p className="text-xl font-semibold text-white">{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
                    </div>
                    <div className="flex gap-2">{previousDate ? <Button onClick={() => setSelectedDate(previousDate)} className={softButtonClasses("ghost")}>Older</Button> : null}{nextDate ? <Button onClick={() => setSelectedDate(nextDate)} className={softButtonClasses("ghost")}>Newer</Button> : null}</div>
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => <div key={name} className="px-2 py-1 text-center text-xs uppercase tracking-[0.18em] text-zinc-500">{name}</div>)}
                    {calendarDays.map((cell) => {
                      const positive = cell.summary.dayR > 0;
                      const negative = cell.summary.dayR < 0;
                      return (
                        <button key={cell.key} onClick={() => { setSelectedDate(cell.key); setTradeForm((prev) => ({ ...prev, date: cell.key })); }} className={`min-h-[108px] rounded-[1.2rem] border p-3 text-left transition ${cell.isSelected ? "border-emerald-300/30 bg-emerald-400/10" : "border-white/10 bg-white/5 hover:bg-white/[0.08]"} ${!cell.inMonth ? "opacity-45" : "opacity-100"}`}>
                          <div className="flex items-center justify-between gap-2"><span className={`text-sm font-medium ${cell.isToday ? "text-emerald-200" : "text-white"}`}>{cell.dayNumber}</span>{cell.locked ? <Lock className="h-3.5 w-3.5 text-zinc-400" /> : null}</div>
                          <div className="mt-3 space-y-1 text-xs"><div className="text-zinc-400">{cell.summary.count} trade{cell.summary.count === 1 ? "" : "s"}</div><div className={`${positive ? "text-emerald-200" : negative ? "text-red-200" : "text-zinc-400"}`}>{cell.summary.dayR >= 0 ? "+" : ""}{cell.summary.dayR.toFixed(2)}R</div><div className="text-zinc-500">{cell.summary.checklistPct}% checklist</div></div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><BookOpen className="h-5 w-5 text-cyan-300" /> {formatDisplayDate(selectedDate)}</CardTitle>
                  <CardDescription className="text-zinc-400">A fluent daily summary for the selected date.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Day result</p><p className="mt-2 text-2xl font-semibold text-white">{dayR >= 0 ? "+" : ""}{dayR.toFixed(2)}R</p></div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Rule breaks</p><p className="mt-2 text-2xl font-semibold text-white">{dayTrades.filter((t) => !t.followedRules).length}</p></div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Checklist</p><p className="mt-2 text-2xl font-semibold text-white">{checklistPct}%</p></div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Mood</p><p className="mt-2 text-2xl font-semibold text-white">{day.mood}</p></div>
                  </div>
                  <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4"><p className="text-sm font-medium text-white">Premarket plan</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-400">{day.premarketPlan || "No premarket plan written."}</p></div>
                  <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4"><p className="text-sm font-medium text-white">Review + lesson</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-400">{day.review || "No review yet."}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{day.lesson || "No lesson written yet."}</p></div>
                  <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4"><p className="text-sm font-medium text-white">Trades for this date</p><div className="mt-3 space-y-2">{dayTrades.length === 0 ? <p className="text-sm text-zinc-400">No trades logged.</p> : dayTrades.map((trade) => <div key={trade.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-3 py-3"><div><p className="text-sm font-medium text-white">{trade.market} · {trade.direction} · {trade.setup}</p><p className="mt-1 text-xs text-zinc-400">{trade.time || "No time"} · {trade.quality} setup</p></div><Badge className={`rounded-full ${toNum(trade.resultR) >= 0 ? "bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/15" : "bg-red-400/15 text-red-100 hover:bg-red-400/15"}`}>{toNum(trade.resultR) >= 0 ? "+" : ""}{trade.resultR}R</Badge></div>)}</div></div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="playbook" className="mt-4">
            <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white"><FileSpreadsheet className="h-5 w-5 text-emerald-300" /> Editable rulebook and process playbook</CardTitle>
                <CardDescription className="text-zinc-400">Make the system yours without losing structure.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["propFirm", "Prop firm"], ["accountSize", "Account size"], ["focusMarkets", "Focus markets"], ["session", "Session"], ["primarySetup", "Primary setup"], ["secondarySetup", "Secondary setup"], ["maxRiskPerTradeR", "Risk per trade"], ["maxDailyLossR", "Max daily loss"], ["dailyGoalR", "Daily goal"], ["maxTradesPerDay", "Max trades per day"], ["maxLossesPerDay", "Max losses per day"], ["entryRule", "Entry rule"], ["managementRule", "Management rule"], ["stopRule", "Stop rule"], ["newsRule", "News rule"], ["mindRule", "Mind rule"],
                  ].map(([key, label]) => (
                    <div key={key} className={key.includes("Rule") || key === "primarySetup" || key === "secondarySetup" ? "md:col-span-2 xl:col-span-3" : ""}>
                      <p className="mb-2 text-sm text-zinc-300">{label}</p>
                      {String(state.rules[key]).length > 35 ? <Textarea value={String(state.rules[key])} onChange={(e) => setState((prev) => ({ ...prev, rules: { ...prev.rules, [key]: e.target.value } }))} className="min-h-[92px] rounded-[1.4rem] border-white/10 bg-white/5 text-white" /> : <Input value={String(state.rules[key])} onChange={(e) => setState((prev) => ({ ...prev, rules: { ...prev.rules, [key]: e.target.value } }))} className="rounded-2xl border-white/10 bg-white/5 text-white" />}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tools" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-white"><Link2 className="h-5 w-5 text-cyan-300" /> Tool stack</CardTitle>
                    </div>
                    <Button size="sm" className={softButtonClasses("ghost")} onClick={() => setEditingTools((v) => !v)}>
                      {editingTools ? <><Check className="mr-2 h-4 w-4" /> Save</> : <><Pencil className="mr-2 h-4 w-4" /> Edit</>}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {state.links.map((link) => (
                    editingTools ? (
                      <div
                        key={link.id}
                        draggable={editingTools}
                        onPointerDown={() => editingTools && beginHold("links", link.id)}
                        onPointerUp={() => editingTools && cancelHold("links", link.id)}
                        onPointerLeave={() => editingTools && cancelHold("links", link.id)}
                        onDragStart={(e) => handleDragStart("links", link.id, e)}
                        onDragOver={(e) => editingTools && e.preventDefault()}
                        onDrop={(e) => editingTools && handleDrop("links", link.id, e)}
                        onDragEnd={handleDragEnd}
                        style={{ transform: `scale(${getHoldScale("links", link.id)})` }}
                        className={`rounded-[1.35rem] border border-white/10 bg-white/5 transition ${draggingItem.list === "links" && draggingItem.id === link.id ? "opacity-60" : ""}`}
                      >
                        <div className="space-y-3 p-4">
                          <Input value={link.name} onChange={(e) => updateTool(link.id, "name", e.target.value)} className="rounded-2xl border-white/10 bg-black/10 text-white" placeholder="Tool name" />
                          <Input value={link.url} onChange={(e) => updateTool(link.id, "url", e.target.value)} className="rounded-2xl border-white/10 bg-black/10 text-white" placeholder="URL" />
                          <Input value={link.note} onChange={(e) => updateTool(link.id, "note", e.target.value)} className="rounded-2xl border-white/10 bg-black/10 text-white" placeholder="Short note" />
                          <div className="flex items-center justify-between gap-2">
                            <HoldHint active={isDragReady("links", link.id)} />
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button size="sm" className={softButtonClasses("ghost")}><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
                              </DialogTrigger>
                              <DialogContent className="rounded-[1.5rem] border-white/10 bg-zinc-950 text-white">
                                <DialogHeader><DialogTitle>Delete tool?</DialogTitle></DialogHeader>
                                <p className="text-sm text-zinc-300">This tool entry will be removed.</p>
                                <Button className={softButtonClasses("danger")} onClick={() => removeTool(link.id)}>Yes, delete tool</Button>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <a
                        key={link.id}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => handleToolOpen(link.url, event)}
                        className="flex w-full items-center justify-between rounded-[1.35rem] border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:bg-white/[0.08] active:scale-[0.99] cursor-pointer"
                      >
                        <div>
                          <p className="font-medium text-white">{link.name}</p>
                          <p className="mt-1 text-sm text-zinc-400">{link.note}</p>
                        </div>
                        <Link2 className="h-4 w-4 text-zinc-400 pointer-events-none" />
                      </a>
                    )
                  ))}
                  {editingTools ? (
                    <div className="rounded-[1.35rem] border border-dashed border-white/10 bg-white/5 p-4">
                      <div className="grid gap-3">
                        <Input value={newTool.name} onChange={(e) => setNewTool((prev) => ({ ...prev, name: e.target.value }))} placeholder="Tool name" className="rounded-2xl border-white/10 bg-black/10 text-white" />
                        <Input value={newTool.url} onChange={(e) => setNewTool((prev) => ({ ...prev, url: e.target.value }))} placeholder="URL" className="rounded-2xl border-white/10 bg-black/10 text-white" />
                        <Input value={newTool.note} onChange={(e) => setNewTool((prev) => ({ ...prev, note: e.target.value }))} placeholder="Short note" className="rounded-2xl border-white/10 bg-black/10 text-white" />
                        <Button className={softButtonClasses()} onClick={addTool}><Plus className="mr-2 h-4 w-4" /> Add tool</Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="rounded-[2rem] border-white/10 bg-white/[0.04]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white"><Zap className="h-5 w-5 text-emerald-300" /> Ideas that make this more useful</CardTitle>
                  <CardDescription className="text-zinc-400">The page now supports more than raw journaling.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4"><p className="font-medium text-white">Fast daily workflow</p><p className="mt-2 text-sm leading-6 text-zinc-400">Prep, trade, and review are separated so you do not feel overloaded.</p></div>
                  <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4"><p className="font-medium text-white">Clean rule visibility</p><p className="mt-2 text-sm leading-6 text-zinc-400">Rule breaks and mistake types are highlighted instead of buried.</p></div>
                  <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4"><p className="font-medium text-white">Useful for others too</p><p className="mt-2 text-sm leading-6 text-zinc-400">Custom checklist items, editable rules, tool stack editing, and import/export make it reusable.</p></div>
                  <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4"><p className="font-medium text-white">Drag editing</p><p className="mt-2 text-sm leading-6 text-zinc-400">Hold an editable list item for half a second, then drag it to rearrange.</p></div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
