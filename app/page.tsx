"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import careersData from "@/data/careers.json";
import subfieldsData from "@/data/subfields.json";
import QuickTest from "./QuickTest";
import CareerDetail from "./CareerDetail";
import Roadmap, {
  EMPTY_PLAN,
  EMPTY_TIMELINE,
  type Plan,
  type Timeline,
  type Career as BoardCareer,
  type Decision,
  type DecisionOption,
} from "./Roadmap";
import { T, fieldName, type Lang } from "./i18n";

type TraitType = "strength" | "interest" | "value" | "dislike";
type Trait = { id: string; label: string; type: TraitType; source: string };
type Rank = { id: string; score: number; reason: string; titleKo?: string };
type Career = {
  id: string;
  title: string;
  field?: string;
  summary: string;
  skills: string[];
  onetCode?: string;
  parentId?: string;
};
type Msg = { role: "user" | "coach"; text: string };

const careers = careersData as unknown as Career[];
const subfields = subfieldsData as unknown as Record<string, Career[]>;

const TYPE_STYLE: Record<TraitType, string> = {
  strength: "bg-blue-50 text-blue-700 border-blue-200",
  interest: "bg-violet-50 text-violet-700 border-violet-200",
  value: "bg-emerald-50 text-emerald-700 border-emerald-200",
  dislike: "bg-gray-100 text-gray-600 border-gray-200",
};

const SHOW_COUNT = 8;
const BOARD_MAX = 10;

const FIELDS = Array.from(new Set(careers.map((c) => c.field).filter(Boolean))) as string[];

function sampleTraits(lang: Lang): Trait[] {
  const ko = lang === "ko";
  return [
    { id: "s1", label: ko ? "꼼꼼하게 정리하기" : "organizing things neatly", type: "strength", source: "sample" },
    { id: "s2", label: ko ? "그림 그리기" : "drawing", type: "interest", source: "sample" },
    { id: "s3", label: ko ? "친구 고민 들어주기" : "listening to friends' problems", type: "strength", source: "sample" },
    { id: "s4", label: ko ? "사물이 작동하는 원리" : "how things work", type: "interest", source: "sample" },
    { id: "s5", label: ko ? "의미 있는 일" : "meaningful work", type: "value", source: "sample" },
  ];
}

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="inline-flex rounded-full border bg-white p-0.5 text-xs">
      {(["en", "ko"] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`rounded-full px-3 py-1 ${lang === l ? "bg-slate-900 text-white" : "text-slate-500"}`}
        >
          {l === "en" ? "EN" : "한국어"}
        </button>
      ))}
    </div>
  );
}

function getStaticCareer(id: string, field: string | null) {
  const list = field ? subfields[field] ?? [] : careers;
  return list.find((c) => c.id === id);
}

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const lang = "en" as Lang; // English only for now ("as" keeps the old Korean checks valid)
  const t = T[lang];
  const [input, setInput] = useState("");
  const [traits, setTraits] = useState<Trait[]>([]);
  const [ranking, setRanking] = useState<Rank[]>([]);
  const [field, setField] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [liked, setLiked] = useState<Record<string, string>>({});
  const [rising, setRising] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<"start" | "test" | "chat">("start");
  const [openCareer, setOpenCareer] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState("");
  // A new message that contradicts an older trait: the coach asks before changing anything.
  const [pendingConflict, setPendingConflict] = useState<{
    label: string;
    newLabel: string;
    newType: string;
    question: string;
  } | null>(null);
  // LinkedIn analysis runs automatically, one career at a time, for every career on the roadmap.
  const marketDone = useRef<Set<string>>(new Set());
  const marketBusy = useRef(false);
  const [marketTick, setMarketTick] = useState(0);
  const [majors, setMajors] = useState<string[]>([]);
  const [beyond, setBeyond] = useState<Rank[]>([]);
  const [showCount, setShowCount] = useState(SHOW_COUNT);
  const [board, setBoard] = useState<(Career & { titleKo?: string })[]>([]);
  const [view, setView] = useState<"explore" | "roadmap">("explore");
  const [pool, setPool] = useState<Career[]>([]);
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [timeline, setTimeline] = useState<Timeline>(EMPTY_TIMELINE);
  const [detailFallback, setDetailFallback] = useState<BoardCareer | null>(null);
  // "why?" question after adding / dismissing a career
  const [reasonAsk, setReasonAsk] = useState<{
    title: string;
    kind: "like" | "dislike" | "activity";
    mood?: "good" | "ok" | "bad";
    text: string;
  } | null>(null);
  // roadmap is full: which career is waiting to be added
  const [pendingAdd, setPendingAdd] = useState<{ r: Rank; c: Career } | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: boolean } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  function showToast(text: string, action = false) {
    setToast({ text, action });
    setTimeout(() => setToast(null), 3500);
  }
  const userIdRef = useRef<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "neon" | "local">("idle");

  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const localKey = () => `profile:${user ? `user:${user.id}` : userIdRef.current}`;

  function applySnapshot(d: Record<string, never>) {
    if (d.messages) setMessages(d.messages);
    if (d.traits) setTraits(d.traits);
    if (d.ranking) setRanking(d.ranking);
    if (d.field !== undefined) setField(d.field);
    if (d.hidden) setHidden(d.hidden);
    if (d.liked) setLiked(d.liked);
    if (d.majors) setMajors(d.majors);
    if (d.beyond) setBeyond(d.beyond);
    if (d.board) setBoard(d.board);
    if (d.pool) setPool(d.pool);
    // older saves used a different roadmap shape; only restore the current one
    if (d.plan && Array.isArray((d.plan as Plan).decisions)) setPlan(d.plan);
    if (d.timeline) setTimeline(d.timeline);
    if (d.showCount) setShowCount(d.showCount);
    if (d.stage === "chat") setStage("chat");
  }

  function resetState() {
    setMessages([]);
    setTraits([]);
    setRanking([]);
    setField(null);
    setHidden([]);
    setLiked({});
    setMajors([]);
    setBeyond([]);
    setBoard([]);
    setPool([]);
    setPlan(EMPTY_PLAN);
    setTimeline(EMPTY_TIMELINE);
    setShowCount(SHOW_COUNT);
    setView("explore");
    setStage("start");
  }

  async function fetchProfile(key: string): Promise<Record<string, never> | null> {
    try {
      const res = await fetch(`/api/profile?userId=${encodeURIComponent(userIdRef.current)}`);
      const json = await res.json();
      if (json.data) return json.data;
    } catch {}
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  }

  // On open: find the guest id, check if someone is logged in, then load their profile.
  useEffect(() => {
    let id = "";
    try {
      id = localStorage.getItem("userId") ?? "";
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("userId", id);
      }
    } catch {
      id = `anon-${Date.now()}`;
    }
    userIdRef.current = id;

    (async () => {
      let me: { id: string; username: string } | null = null;
      try {
        me = (await (await fetch("/api/auth")).json()).user ?? null;
      } catch {}
      setUser(me);
      const saved = await fetchProfile(`profile:${me ? `user:${me.id}` : id}`);
      if (saved) applySnapshot(saved);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save after every change (debounced): this browser always, Neon when configured.
  useEffect(() => {
    if (!loaded) return;
    const snapshot = {
      v: 1,
      stage: stage === "test" ? "start" : stage,
      lang,
      messages: messages.slice(-100),
      traits,
      ranking,
      field,
      hidden,
      liked,
      majors,
      beyond,
      board,
      pool,
      plan,
      timeline,
      showCount,
    };
    const key = localKey();
    setSaveStatus("saving");
    const timer = setTimeout(async () => {
      try {
        localStorage.setItem(key, JSON.stringify(snapshot));
      } catch {}
      try {
        const res = await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userIdRef.current, data: snapshot }),
        });
        const json = await res.json();
        setSaveStatus(json.ok ? "neon" : "local");
      } catch {
        setSaveStatus("local");
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, user, stage, lang, messages, traits, ranking, field, hidden, liked, majors, beyond, board, pool, plan, timeline, showCount]);

  async function submitAuth() {
    setAuthBusy(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: authMode, ...authForm }),
      });
      const json = await res.json();
      if (!res.ok || !json.user) {
        setAuthError(t.authErrors[json.error] ?? t.authErrors.server);
        return;
      }
      setLoaded(false); // pause saving while we switch accounts
      setUser(json.user);
      if (!json.isNew) {
        // Existing account: load its saved progress (if any) instead of the guest's.
        const saved = await fetchProfile(`profile:user:${json.user.id}`);
        if (saved) {
          resetState();
          applySnapshot(saved);
        }
      }
      // New account: keep the current progress; the save effect stores it under the account.
      setLoaded(true);
      setAuthOpen(false);
      setAuthForm({ username: "", password: "" });
    } catch {
      setAuthError(t.authErrors.server);
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    setLoaded(false);
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {}
    setUser(null);
    resetState();
    setLoaded(true);
  }

  useEffect(() => {
    if (!loaded || marketBusy.current) return;
    const next = board.find((b) => !marketDone.current.has(b.id));
    if (!next) return;
    marketBusy.current = true;
    marketDone.current.add(next.id);
    fetch("/api/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ careerId: next.id, title: next.title, scrapeOnly: true }),
    })
      .catch((e) => console.warn("LinkedIn scan failed:", e))
      .finally(() => {
        marketBusy.current = false;
        setMarketTick((n) => n + 1); // move on to the next career
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, board, marketTick]);

  async function startOver() {
    if (!window.confirm(t.startOverConfirm)) return;
    try {
      localStorage.removeItem(localKey());
      await fetch(`/api/profile?userId=${encodeURIComponent(userIdRef.current)}`, { method: "DELETE" });
    } catch {}
    resetState();
  }


  // Careers the server found across all of O*NET live in the pool; look there first.
  const getCareer = (id: string, f: string | null) =>
    pool.find((c) => c.id === id) ?? getStaticCareer(id, f) ?? getStaticCareer(id, null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);


  // The ONLY place the AI reads what the user says. It updates About me and asks one follow-up question.
  async function callChat(message: string, opts: { context?: string } = {}) {
    setMessages((m) => [...m, { role: "user", text: message }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          traits,
          context: opts.context ?? null,
          pendingConflict,
          history: messages.filter((m) => m.role === "user").map((m) => m.text).slice(-15),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);

      const known = new Set(traits.map((x) => x.label.toLowerCase()));
      const fresh: Trait[] = (data.newTraits ?? [])
        .filter((x: Trait) => !known.has(x.label.toLowerCase()))
        .map((x: Trait, i: number) => ({ ...x, id: `${x.id}-${Date.now()}-${i}` }));
      // Interests the user showed they are good at move to strengths.
      const upgrades: { label: string; newLabel?: string | null }[] = data.upgrades ?? [];
      const promoted: string[] = [];
      let updated = traits.map((tr) => {
        const u = upgrades.find((x) => x.label?.toLowerCase() === tr.label.toLowerCase());
        if (u && tr.type === "interest") {
          promoted.push(u.newLabel || tr.label);
          return { ...tr, type: "strength" as TraitType, label: u.newLabel || tr.label, source: `${tr.source} ✓` };
        }
        return tr;
      });
      // The user agreed to change a trait the coach asked about.
      const rep = data.replaced as { label: string; newLabel: string; newType: string } | null;
      if (rep) {
        updated = updated.map((tr) =>
          tr.label.toLowerCase() === rep.label.toLowerCase()
            ? { ...tr, label: rep.newLabel, type: (rep.newType || tr.type) as TraitType, source: message }
            : tr
        );
        showToast(t.traitUpdated(rep.label, rep.newLabel));
      }
      setTraits([...updated, ...fresh]);
      if (data.conflictDone) setPendingConflict(null);
      if (data.conflict) setPendingConflict(data.conflict);
      if (promoted.length) showToast(t.promoted(promoted.join(", ")));

      // Background the user stated (majors, year, graduation, hours) is used by every later search and roadmap.
      const f = data.facts ?? {};
      if (Array.isArray(f.majors) && f.majors.length) setMajors(f.majors);
      const tl: Partial<Timeline> = {};
      if (f.status) tl.status = f.status;
      if (f.gradTerm) tl.gradTerm = f.gradTerm;
      if (f.gradYear) tl.gradYear = f.gradYear;
      if (f.hoursPerWeek) tl.hoursPerWeek = f.hoursPerWeek;
      const gotFacts = (Array.isArray(f.majors) && f.majors.length) || Object.keys(tl).length;
      if (Object.keys(tl).length) setTimeline((prev) => ({ ...prev, ...tl }));
      if (gotFacts) showToast(t.backgroundSaved);

      const replies: Msg[] = [];
      if (fresh.length) replies.push({ role: "coach", text: t.addedTraits(fresh.map((x) => x.label).join(", ")) });
      if (data.conflict?.question) replies.push({ role: "coach", text: data.conflict.question });
      else if (data.followUp) replies.push({ role: "coach", text: data.followUp });
      if (!replies.length) replies.push({ role: "coach", text: t.noted });
      setMessages((m) => [...m, ...replies]);
    } catch (e) {
      console.warn("chat failed:", e);
      setMessages((m) => [...m, { role: "coach", text: String(e).includes("quota") ? t.quota : t.lost }]);
    } finally {
      setLoading(false);
    }
  }

  // "Find careers" button: rank 15 careers from the full O*NET list, using only About me.
  async function findCareers() {
    if (finding) return;
    if (!traits.length) {
      setFindError(t.findNeedsTraits);
      return;
    }
    setFinding(true);
    setFindError("");
    try {
      const res = await fetch("/api/careers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traits,
          majors,
          timeline,
          notInterested: hidden.map((id) => getCareer(id, null)?.title ?? id),
          added: board.map((b) => b.title),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      const found = data.careers as (Career & { score: number; reason: string })[];
      // Keep the careers already on the roadmap findable, then the new list.
      const keep = pool.filter((c) => board.some((b) => b.id === c.id));
      setPool([...found.map(({ score: _s, reason: _r, ...c }) => c), ...keep.filter((k) => !found.some((f) => f.id === k.id))]);
      setRanking(found.map((c) => ({ id: c.id, score: c.score, reason: c.reason })));
      setField(null);
    } catch (e) {
      setFindError(String(e).includes("quota") ? t.quota : t.findFailed);
    } finally {
      setFinding(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    if (reasonAsk) sendReason(text);
    else callChat(text);
  }

  // Filter the current list by field. No AI, no new list.
  function confirmField(f: string) {
    setField(field === f ? null : f);
  }

  function loadSample() {
    const seed = sampleTraits(lang);
    setTraits(seed);
    setMessages((m) => [...m, { role: "user", text: t.sampleMsg }, { role: "coach", text: t.sampleLoaded }]);
  }

  function finishTest(seed: Trait[], top: string[]) {
    setTraits(seed);
    setStage("chat");
    setMessages((m) => [
      ...m,
      { role: "user", text: `${t.finishedTest}${top.join(" + ")})` },
      { role: "coach", text: t.sampleLoaded },
    ]);
  }

  // "Not interested" careers leave the list; added ones stay and are marked.
  const remaining = ranking.filter((r) => !hidden.includes(r.id) && !!getCareer(r.id, null));
  const visible = field ? remaining.filter((r) => getCareer(r.id, null)?.field === field) : remaining;
  const isAdded = (id: string) => board.some((b) => b.id === id);

  function markCareer(r: Rank, k: string, c: Career) {
    setLiked({ ...liked, [r.id]: k });
    if (k === "interested") {
      if (!board.some((b) => b.id === r.id)) {
        if (board.length >= BOARD_MAX) {
          setLiked(liked); // not added yet
          setPendingAdd({ r, c });
          return;
        }
        setBoard([...board, { ...c, titleKo: r.titleKo }]);
        if (plan.path) setPlan({ ...plan, stale: true });
        showToast(t.addedToRoadmap, true);
        askWhy(c.title, "like");
      }
    } else {
      setBoard(board.filter((b) => b.id !== r.id));
    }
  }

  // A decision made inside the roadmap: record it, and narrow careers / majors when it says so.
  function decide(d: Decision, o: DecisionOption) {
    const made = {
      decisionId: d.id,
      question: d.question,
      kind: d.kind,
      choice: o.label,
      careerId: o.careerId,
      at: new Date().toISOString(),
    };
    setPlan({ ...plan, decisions: [...plan.decisions.filter((x) => x.decisionId !== d.id), made], stale: true });

    if (d.kind === "specialization" && o.title) {
      const parent = board.find((b) => b.id === o.careerId);
      const spec: BoardCareer = {
        id: `spec-${o.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        title: o.title,
        titleKo: lang === "ko" ? o.label : undefined,
        summary: o.summary ?? o.title,
        skills: o.skills ?? [],
        field: parent?.field,
        onetCode: parent?.onetCode,
        parentId: parent?.id,
      };
      setBoard((prev) => {
        const without = prev.filter((b) => b.id !== spec.id);
        return parent ? without.map((b) => (b.id === parent.id ? spec : b)) : [...without, spec];
      });
    }
    if (d.kind === "major" || d.kind === "field") {
      const hit = FIELDS.find(
        (f) => o.label.toLowerCase().includes(f.toLowerCase()) || o.label.includes(fieldName(f, "ko"))
      );
      const pick = hit ?? (o.label.trim().length <= 40 ? o.label.trim() : null);
      if (pick && !majors.includes(pick)) setMajors([...majors, pick]);
    }
  }

  function openFromRoadmap(c: BoardCareer) {
    setDetailFallback(c);
    setOpenCareer(c.id);
  }

  function swapIntoBoard(outId: string) {
    if (!pendingAdd) return;
    const { r, c } = pendingAdd;
    const nextLiked = { ...liked, [r.id]: "interested" };
    delete nextLiked[outId];
    setLiked(nextLiked);
    setBoard([...board.filter((b) => b.id !== outId), { ...c, titleKo: r.titleKo }]);
    if (plan.path) setPlan({ ...plan, stale: true });
    setPendingAdd(null);
    showToast(t.addedToRoadmap, true);
    askWhy(lang === "ko" && r.titleKo ? r.titleKo : c.title, "like");
  }

  function askWhy(title: string, kind: "like" | "dislike") {
    setMessages((m) => [...m, { role: "coach", text: kind === "like" ? t.whyLike(title) : t.whyDislike(title) }]);
    setReasonAsk({ title, kind, text: "" });
  }

  function sendReason(text: string) {
    if (!reasonAsk) return;
    const answer = text.trim();
    const { title, kind, mood } = reasonAsk;
    setReasonAsk(null);
    if (!answer) return;
    callChat(answer, {
      context:
        kind === "activity"
          ? `Reflection after trying the activity "${title}" (it felt ${mood === "good" ? "good" : mood === "bad" ? "bad" : "okay"})`
          : `The user explained why they ${kind === "like" ? "added" : "are not interested in"} the career "${title}"`,
    });
  }

  function removeFromBoard(id: string) {
    setBoard(board.filter((b) => b.id !== id));
    if (plan.path) setPlan({ ...plan, stale: true });
    const next = { ...liked };
    delete next[id];
    setLiked(next);
  }

  function onTaskFeedback(taskText: string, mood: "good" | "ok" | "bad") {
    // The coach asks what part felt that way, right in the chat.
    setMessages((m) => [...m, { role: "coach", text: t.whatPartAsk(taskText, mood) }]);
    setReasonAsk({ title: taskText, kind: "activity", mood, text: "" });
  }



  function hideCareer(id: string) {
    setHidden([...hidden, id]);
  }
  const topFields = Array.from(new Set(remaining.map((r) => getCareer(r.id, null)?.field).filter(Boolean))) as string[];


  const authButton = user ? (
    <span className="text-xs text-slate-600 flex items-center gap-2">
      👤 {user.username}
      <button onClick={logout} className="underline text-slate-500 hover:text-slate-800">
        {t.logout}
      </button>
    </span>
  ) : (
    <button
      onClick={() => {
        setAuthMode("login");
        setAuthError("");
        setAuthOpen(true);
      }}
      className="text-xs rounded-full px-3 py-1 border bg-white text-slate-700 hover:bg-slate-50"
    >
      {t.login}
    </button>
  );

  const authModal = authOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={() => setAuthOpen(false)} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl p-6 text-slate-900 shadow-xl">
        <h2 className="text-xl font-semibold">{authMode === "login" ? t.login : t.signup}</h2>
        {authMode === "signup" && <p className="text-xs text-slate-500 mt-1">{t.signupNote}</p>}
        <div className="mt-4 space-y-3">
          <input
            value={authForm.username}
            onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })}
            placeholder={t.username}
            autoComplete="username"
            className="w-full border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />
          <input
            type="password"
            value={authForm.password}
            onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submitAuth()}
            placeholder={t.password}
            autoComplete={authMode === "login" ? "current-password" : "new-password"}
            className="w-full border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />
          {authError && <p className="text-sm text-red-600">{authError}</p>}
          <button
            onClick={submitAuth}
            disabled={authBusy}
            className="w-full bg-blue-600 text-white rounded-xl py-2 text-sm font-medium disabled:opacity-50"
          >
            {authMode === "login" ? t.login : t.signup}
          </button>
          <button
            onClick={() => {
              setAuthMode(authMode === "login" ? "signup" : "login");
              setAuthError("");
            }}
            className="w-full text-xs text-slate-500 underline"
          >
            {authMode === "login" ? t.noAccount : t.haveAccount}
          </button>
        </div>
      </div>
    </div>
  );

  if (stage === "start") {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
        <div className="fixed top-4 right-4 flex items-center gap-3">{authButton}</div>
        {authModal}
        <div className="max-w-3xl w-full text-center">
          <h1 className="text-3xl font-semibold">Find Your Courses</h1>
          <p className="text-slate-500 mt-2">{t.tagline}</p>
          <div className="grid md:grid-cols-2 gap-4 mt-10 text-left">
            <button
              onClick={() => setStage("test")}
              className="bg-white border rounded-2xl p-6 hover:shadow-md hover:border-blue-300 transition"
            >
              <div className="text-3xl">🧭</div>
              <h2 className="font-semibold text-lg mt-3">{t.startTestTitle}</h2>
              <p className="text-sm text-slate-500 mt-1">{t.startTestDesc}</p>
            </button>
            <button
              onClick={() => setStage("chat")}
              className="bg-white border rounded-2xl p-6 hover:shadow-md hover:border-blue-300 transition"
            >
              <div className="text-3xl">💬</div>
              <h2 className="font-semibold text-lg mt-3">{t.startChatTitle}</h2>
              <p className="text-sm text-slate-500 mt-1">{t.startChatDesc}</p>
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (stage === "test") {
    return (
      <>
        <QuickTest lang={lang} onDone={finishTest} onSkip={() => setStage("chat")} />
      </>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="px-6 py-4 border-b bg-white flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Find Your Courses</h1>
          <p className="text-sm text-slate-500">{t.chatTagline}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {saveStatus === "saving" ? t.saving : saveStatus === "neon" ? t.savedNeon : saveStatus === "local" ? t.savedLocal : ""}
          </span>
          <button onClick={startOver} className="text-xs text-slate-500 hover:text-slate-800 underline">
            {t.startOver}
          </button>
          {authButton}
        </div>
      </header>
      {authModal}

      <div className="grid md:grid-cols-5 gap-4 p-4 max-w-7xl mx-auto">
        {/* Chat */}
        <section className="md:col-span-2 bg-white rounded-2xl border flex flex-col h-[80vh]">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-slate-100 text-slate-800">{t.greeting}</div>
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {reasonAsk && !loading && (
              <div className="flex flex-wrap gap-1.5 pl-1">
                {(reasonAsk.kind === "activity"
                  ? t.activityChips[reasonAsk.mood ?? "ok"]
                  : reasonAsk.kind === "like"
                    ? t.likeChips
                    : t.dislikeChips
                ).map((chip) => (
                  <button
                    key={chip}
                    onClick={() => sendReason(chip)}
                    className="text-xs border border-blue-200 bg-blue-50 text-blue-800 rounded-full px-2.5 py-1 hover:bg-blue-100"
                  >
                    {chip}
                  </button>
                ))}
                <button onClick={() => setReasonAsk(null)} className="text-xs text-slate-400 underline px-1">
                  {t.skip}
                </button>
              </div>
            )}
            {pendingConflict && !reasonAsk && !loading && (
              <div className="flex flex-wrap gap-1.5 pl-1">
                {t.conflictChips.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => callChat(chip)}
                    className="text-xs border border-amber-200 bg-amber-50 text-amber-800 rounded-full px-2.5 py-1 hover:bg-amber-100"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
            {loading && <div className="text-sm text-slate-400">{t.thinking}</div>}
            {traits.length === 0 && !loading && (
              <button onClick={loadSample} className="text-sm text-blue-600 underline">
                {t.trySample}
              </button>
            )}
            <div ref={endRef} />
          </div>
          <div className="px-3 pt-2 flex flex-wrap gap-2">
            {t.hints.map((h) => (
              <button
                key={h}
                onClick={() => setInput(h + " ")}
                className="text-xs border rounded-full px-3 py-1 text-slate-600 hover:bg-slate-50"
              >
                {h}
              </button>
            ))}
          </div>
          <div className="p-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={t.placeholder}
              className="flex-1 border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              onClick={send}
              disabled={loading}
              className="bg-blue-600 text-white rounded-xl px-4 text-sm disabled:opacity-50"
            >
              {t.send}
            </button>
          </div>
        </section>

        {/* Results */}
        <section className="md:col-span-3 space-y-4 md:h-[80vh] md:overflow-y-auto">
          <div className="bg-white rounded-2xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">{t.aboutMe}</h2>
                <p className="text-xs text-slate-500">
                  {t.aboutSummary(
                    traits.filter((x) => x.type === "strength").length,
                    traits.filter((x) => x.type === "interest").length
                  )}
                  {majors.length > 0 && ` · ${majors.join(", ")}`}
                </p>
              </div>
              <button
                onClick={() => setAboutOpen(true)}
                className="text-xs rounded-full px-3 py-1 border text-slate-700 hover:bg-slate-50"
              >
                {t.seeAll} →
              </button>
            </div>
            {traits.length === 0 ? (
              <p className="text-sm text-slate-400 mt-2">{t.aboutEmpty}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {[...traits]
                  .sort((x, y) => (x.type === "strength" ? -1 : 0) - (y.type === "strength" ? -1 : 0))
                  .slice(0, 6)
                  .map((tr) => (
                    <motion.span
                      key={tr.id}
                      layout
                      className={`text-xs border rounded-full px-2.5 py-0.5 ${TYPE_STYLE[tr.type]}`}
                    >
                      {tr.type === "strength" ? "💪 " : ""}
                      {tr.label}
                    </motion.span>
                  ))}
                {traits.length > 6 && (
                  <button onClick={() => setAboutOpen(true)} className="text-xs text-slate-500 underline">
                    +{traits.length - 6}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-1 bg-white border rounded-xl p-1 w-fit">
            {(["explore", "roadmap"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-sm rounded-lg px-4 py-1.5 ${view === v ? "bg-slate-900 text-white" : "text-slate-600"}`}
              >
                {v === "explore" ? t.tabExplore : t.tabRoadmap}
                {v === "roadmap" && board.length > 0 && (
                  <span className="ml-1.5 text-xs rounded-full bg-blue-500 text-white px-1.5">{board.length}</span>
                )}
              </button>
            ))}
          </div>

          {view === "roadmap" ? (
            <Roadmap
              board={board}
              traits={traits}
              majors={majors}
              lang={lang}
              titleOf={(c) => (lang === "ko" && c.titleKo ? c.titleKo : c.title)}
              onRemove={removeFromBoard}
              onOpen={openFromRoadmap}
              onDecide={decide}
              field={field}
              onFeedback={onTaskFeedback}
              plan={plan}
              setPlan={setPlan}
              timeline={timeline}
              setTimeline={setTimeline}
            />
          ) : (
          <>
          <div className="bg-white rounded-2xl border p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div>
                <h2 className="font-semibold">{t.careersForYou}</h2>
                <p className="text-xs text-slate-500">{t.findHint}</p>
              </div>
              <button
                onClick={findCareers}
                disabled={finding || loading}
                className="text-sm rounded-full px-4 py-1.5 bg-blue-600 text-white disabled:opacity-50 shrink-0"
              >
                {finding ? t.finding : ranking.length ? t.findAgain : t.findButton}
              </button>
            </div>
            {findError && <p className="text-sm text-red-600 mt-2">{findError}</p>}

            {topFields.length > 1 && (
              <div className="my-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setField(null)}
                  className={`text-xs rounded-full px-3 py-1 border ${!field ? "bg-slate-900 text-white border-slate-900" : "text-slate-600"}`}
                >
                  {t.allFields} ({remaining.length})
                </button>
                {topFields.map((f) => (
                  <button
                    key={f}
                    onClick={() => confirmField(f)}
                    className={`text-xs rounded-full px-3 py-1 border ${field === f ? "bg-slate-900 text-white border-slate-900" : "text-slate-600"}`}
                  >
                    {f} ({remaining.filter((r) => getCareer(r.id, null)?.field === f).length})
                  </button>
                ))}
              </div>
            )}

            {visible.length === 0 && (
              <p className="text-sm text-slate-400 mt-3">{finding ? t.finding : t.rankingEmpty}</p>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={`${field ?? "all"}-${ranking.length}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-3"
              >
                {visible.map((r, i) => {
                  const c = getCareer(r.id, null)!;
                  const added = isAdded(r.id);
                  return (
                    <motion.div
                      layout
                      key={r.id}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      className={`border rounded-xl p-4 ${
                        rising.includes(r.id) ? "ring-2 ring-emerald-300 bg-emerald-50" : "bg-white"
                      } ${added ? "border-amber-300 bg-amber-50/40" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="text-lg font-semibold text-slate-400 w-6">{i + 1}</div>
                        <div className="flex-1">
                          <div className="flex justify-between items-center">
                            <h3 className="font-semibold">
                              {added && <span className="text-amber-500 mr-1">★</span>}
                              {c.title}
                              {c.field && <span className="ml-2 text-xs font-normal text-slate-400">{c.field}</span>}
                            </h3>
                            <span className="text-sm text-slate-500">{r.score}</span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full mt-2">
                            <motion.div
                              className="h-1.5 bg-blue-500 rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${r.score}%` }}
                            />
                          </div>
                          <p className="text-sm italic text-slate-700 mt-2">{r.reason || c.summary}</p>
                          <div className="flex gap-2 mt-3">
                            {added ? (
                              <span className="text-xs rounded-full px-3 py-1 bg-amber-100 text-amber-800">★ {t.added}</span>
                            ) : (
                              <>
                                <button
                                  onClick={() => markCareer(r, "interested", c)}
                                  className="text-xs rounded-full px-3 py-1 bg-blue-600 text-white hover:bg-blue-700"
                                >
                                  {t.addToRoadmap}
                                </button>
                                <button
                                  onClick={() => {
                                    hideCareer(r.id);
                                    askWhy(c.title, "dislike");
                                  }}
                                  className="text-xs border rounded-full px-3 py-1 text-slate-600 hover:bg-slate-50"
                                >
                                  {t.notInterested}
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => setOpenCareer(r.id)}
                              className="ml-auto text-xs rounded-full px-3 py-1 bg-slate-900 text-white"
                            >
                              {t.explore}
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </div>
          </>
          )}
        </section>
      </div>

      <footer className="text-center text-[11px] text-slate-400 pb-4">
        {t.footer}
      </footer>

      {aboutOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAboutOpen(false)} />
          <motion.aside
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="relative w-full max-w-md h-full bg-white shadow-xl overflow-y-auto p-6 text-slate-900"
          >
            <button
              onClick={() => setAboutOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-xl"
            >
              ×
            </button>
            <h2 className="text-xl font-semibold">{t.aboutMe}</h2>
            <p className="text-xs text-slate-500 mt-1">{t.aboutHint}</p>

            <div className="mt-5 rounded-xl border bg-slate-50 p-3">
              <div className="text-xs font-semibold text-slate-500 mb-1">{t.background}</div>
              <ul className="text-sm text-slate-700 space-y-0.5">
                <li>{t.bgMajors}: {majors.length ? majors.join(", ") : "—"}</li>
                <li>{t.bgStatus}: {timeline.status ? t.statuses[timeline.status] ?? timeline.status : "—"}</li>
                <li>
                  {t.gradLabel}:{" "}
                  {timeline.gradYear ? `${timeline.gradTerm ? t.terms[timeline.gradTerm] + " " : ""}${timeline.gradYear}` : "—"}
                </li>
                <li>{t.hoursLabel}: {timeline.hoursPerWeek}h</li>
              </ul>
              <p className="text-xs text-slate-400 mt-2">{t.backgroundHint}</p>
            </div>

            <div className="mt-6 space-y-4">
              {(["strength", "interest", "value", "dislike"] as TraitType[]).map((type) => {
                const list = traits.filter((x) => x.type === type);
                return (
                  <div key={type}>
                    <div className="text-xs font-semibold text-slate-500 mb-1">
                      {type === "strength" ? "💪 " : ""}
                      {t.types[type]} ({list.length})
                    </div>
                    {list.length === 0 ? (
                      <p className="text-xs text-slate-300">—</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <AnimatePresence>
                          {list.map((tr) => (
                            <motion.span
                              key={tr.id}
                              layout
                              initial={{ scale: 0.8, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.8, opacity: 0 }}
                              title={tr.source}
                              className={`text-sm border rounded-full px-3 py-1 ${TYPE_STYLE[type]}`}
                            >
                              {tr.label}
                              <button
                                onClick={() => setTraits(traits.filter((x) => x.id !== tr.id))}
                                className="ml-2 opacity-60 hover:opacity-100"
                              >
                                ×
                              </button>
                            </motion.span>
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.aside>
        </div>
      )}

      {pendingAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setPendingAdd(null)} />
          <div className="relative w-full max-w-md bg-white rounded-2xl p-6 text-slate-900 shadow-xl">
            <h2 className="text-lg font-semibold">{t.boardFull}</h2>
            <p className="text-sm text-slate-600 mt-1">
              {t.boardFullDesc(
                lang === "ko" && pendingAdd.r.titleKo ? pendingAdd.r.titleKo : pendingAdd.c.title
              )}
            </p>
            <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
              {[...board]
                .map((b) => ({ b, score: ranking.find((x) => x.id === b.id)?.score ?? 0 }))
                .sort((x, y) => x.score - y.score)
                .map(({ b }, i) => (
                  <div key={b.id} className="flex items-center gap-2 border rounded-xl px-3 py-2">
                    <span className="flex-1 text-sm">
                      {lang === "ko" && b.titleKo ? b.titleKo : b.title}
                      {i === 0 && <span className="ml-2 text-[11px] text-amber-700">· {t.leastFit}</span>}
                    </span>
                    <button
                      onClick={() => swapIntoBoard(b.id)}
                      className="text-xs rounded-full px-3 py-1 bg-blue-600 text-white"
                    >
                      {t.swapOut}
                    </button>
                  </div>
                ))}
            </div>
            <button onClick={() => setPendingAdd(null)} className="mt-4 w-full text-sm text-slate-500 underline">
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-slate-900 text-white text-sm px-5 py-2.5 shadow-lg"
          >
            ✓ {toast.text}
            {toast.action && (
              <button
                onClick={() => {
                  setView("roadmap");
                  setToast(null);
                }}
                className="underline text-blue-200"
              >
                {t.viewRoadmap}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {openCareer && (
        <CareerDetail
          careerId={openCareer}
          field={field}
          traits={traits}
          lang={lang}
          fallback={detailFallback ?? ((getCareer(openCareer, field) as BoardCareer | undefined) ?? null)}
          inBoard={board.some((b) => b.id === openCareer)}
          reason={ranking.find((r) => r.id === openCareer)?.reason ?? ""}
          onClose={() => {
            setOpenCareer(null);
            setDetailFallback(null);
          }}
        />
      )}
    </main>
  );
}