"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import careersData from "@/data/careers.json";
import subfieldsData from "@/data/subfields.json";
import QuickTest from "./QuickTest";
import CareerDetail from "./CareerDetail";
import Roadmap, { EMPTY_PLAN, type Plan } from "./Roadmap";
import { T, fieldName, type Lang } from "./i18n";

type TraitType = "strength" | "interest" | "value" | "dislike";
type Trait = { id: string; label: string; type: TraitType; source: string };
type Rank = { id: string; score: number; reason: string; titleKo?: string };
type Career = { id: string; title: string; field?: string; summary: string; skills: string[] };
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
  const [lang, setLangState] = useState<Lang>("en");
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
  const [majors, setMajors] = useState<string[]>([]);
  const [beyond, setBeyond] = useState<Rank[]>([]);
  const [showCount, setShowCount] = useState(SHOW_COUNT);
  const [board, setBoard] = useState<(Career & { titleKo?: string })[]>([]);
  const [view, setView] = useState<"explore" | "roadmap">("explore");
  const [pool, setPool] = useState<Career[]>([]);
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const userIdRef = useRef<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "neon" | "local">("idle");

  // Load the saved profile once: Neon first, then this browser as a fallback.
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
      let saved: Record<string, unknown> | null = null;
      try {
        const res = await fetch(`/api/profile?userId=${encodeURIComponent(id)}`);
        const json = await res.json();
        saved = json.data ?? null;
      } catch {}
      if (!saved) {
        try {
          saved = JSON.parse(localStorage.getItem("profile") ?? "null");
        } catch {}
      }
      if (saved) {
        const d = saved as Record<string, never>;
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
        if (d.plan) setPlan(d.plan);
        if (d.showCount) setShowCount(d.showCount);
        if (d.lang === "ko" || d.lang === "en") setLangState(d.lang);
        if (d.stage === "chat") setStage("chat");
      }
      setLoaded(true);
    })();
  }, []);

  // Save after every change (debounced): this browser always, Neon when configured.
  useEffect(() => {
    if (!loaded) return;
    const snapshot = {
      v: 1,
      stage: stage === "test" ? "start" : stage,
      lang,
      messages,
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
      showCount,
    };
    setSaveStatus("saving");
    const timer = setTimeout(async () => {
      try {
        localStorage.setItem("profile", JSON.stringify(snapshot));
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
  }, [loaded, stage, lang, messages, traits, ranking, field, hidden, liked, majors, beyond, board, pool, plan, showCount]);

  async function startOver() {
    if (!window.confirm(t.startOverConfirm)) return;
    try {
      localStorage.removeItem("profile");
      await fetch(`/api/profile?userId=${encodeURIComponent(userIdRef.current)}`, { method: "DELETE" });
    } catch {}
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
    setShowCount(SHOW_COUNT);
    setView("explore");
    setStage("start");
  }

  // Inside a field the server may add extra O*NET careers; look there first.
  const getCareer = (id: string, f: string | null) =>
    (f ? pool.find((c) => c.id === id) : undefined) ?? getStaticCareer(id, f) ?? getStaticCareer(id, null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("lang");
      if (saved === "ko" || saved === "en") setLangState(saved);
    } catch {}
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    try {
      localStorage.setItem("lang", l);
    } catch {}
  }

  async function callChat(
    message: string,
    opts: { show?: boolean; field?: string | null; traits?: Trait[]; majors?: string[]; hidden?: string[] } = {}
  ) {
    const useHidden = opts.hidden ?? hidden;
    const useMajors = opts.majors ?? majors;
    const show = opts.show ?? true;
    const useField = opts.field !== undefined ? opts.field : field;
    const useTraits = opts.traits ?? traits;
    if (show) setMessages((m) => [...m, { role: "user", text: message }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          traits: useTraits,
          confirmedField: useField,
          lang,
          majors: useMajors,
          history: messages.filter((m) => m.role === "user").map((m) => m.text).slice(-15),
          prevRanking: useField === field ? ranking : [],
          feedback: {
            interested: Object.keys(liked).filter((k) => liked[k] === "interested"),
            maybe: Object.keys(liked).filter((k) => liked[k] === "maybe"),
            notForMe: useHidden,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);

      const known = new Set(useTraits.map((t) => t.label.toLowerCase()));
      const fresh: Trait[] = (data.newTraits ?? [])
        .filter((t: Trait) => !known.has(t.label.toLowerCase()))
        .map((t: Trait, i: number) => ({ ...t, id: `${t.id}-${Date.now()}-${i}` }));
      setTraits([...useTraits, ...fresh]);

      const oldPos = new Map(ranking.map((r, i) => [r.id, i]));
      const newRank: Rank[] = [...(data.ranking ?? [])].sort((a, b) => b.score - a.score);
      setRising(
        newRank
          .filter((r, i) => oldPos.has(r.id) && i < (oldPos.get(r.id) as number))
          .map((r) => r.id)
      );
      setTimeout(() => setRising([]), 2000);
      setRanking(newRank);
      if (useField && data.pool?.length) setPool(data.pool);
      if (!useMajors.length) setBeyond([]);
      else if (data.beyond?.length) setBeyond(data.beyond);

      const replies: Msg[] = [];
      if (data.reply) replies.push({ role: "coach", text: data.reply });
      if (data.followUp) replies.push({ role: "coach", text: data.followUp });
      setMessages((m) => [...m, ...replies]);
    } catch (e) {
      console.error(e);
      setMessages((m) => [...m, { role: "coach", text: t.lost }]);
    } finally {
      setLoading(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    callChat(text);
  }

  function confirmField(f: string) {
    setField(f);
    setPool([]);
    setShowCount(SHOW_COUNT);
    const nextMajors = majors.includes(f) ? majors : [...majors, f];
    setMajors(nextMajors);
    setHidden([]);
    setRanking([]);
    callChat(`(user confirmed the field: ${f})`, { show: false, field: f, majors: nextMajors });
  }

  function toggleMajor(m: string) {
    const next = majors.includes(m) ? majors.filter((x) => x !== m) : [...majors, m];
    setMajors(next);
    setBeyond([]);
    if (traits.length) {
      callChat(`(user's majors are now: ${next.join(", ") || "none"})`, { show: false, majors: next });
    }
  }

  function undo() {
    setField(null);
    setShowCount(SHOW_COUNT);
    setHidden([]);
    setRanking([]);
    callChat("(user went back to all careers)", { show: false, field: null });
  }

  function loadSample() {
    const seed = sampleTraits(lang);
    setTraits(seed);
    setMessages((m) => [...m, { role: "user", text: t.sampleMsg }]);
    callChat("(sample student profile loaded)", { show: false, traits: seed });
  }

  function finishTest(seed: Trait[], top: string[]) {
    setTraits(seed);
    setStage("chat");
    setMessages((m) => [...m, { role: "user", text: `${t.finishedTest}${top.join(" + ")})` }]);
    callChat(`(user finished the interest test; top interest areas: ${top.join(", ")})`, {
      show: false,
      traits: seed,
    });
  }

  const remaining = ranking.filter((r) => !hidden.includes(r.id) && getCareer(r.id, field));
  const visible = remaining.slice(0, showCount);

  function markCareer(r: Rank, k: string, c: Career) {
    setLiked({ ...liked, [r.id]: k });
    if (k === "interested") {
      if (!board.some((b) => b.id === r.id)) setBoard([...board, { ...c, titleKo: r.titleKo }]);
    } else {
      setBoard(board.filter((b) => b.id !== r.id));
    }
  }

  function removeFromBoard(id: string) {
    setBoard(board.filter((b) => b.id !== id));
    const next = { ...liked };
    delete next[id];
    setLiked(next);
  }

  function onTaskFeedback(taskText: string, mood: "good" | "ok" | "bad") {
    if (mood === "ok") return;
    const trait: Trait = {
      id: `task-${Date.now()}`,
      label: (mood === "good" ? t.feltTrait.good : t.feltTrait.bad) + taskText,
      type: mood === "good" ? "interest" : "dislike",
      source: "Roadmap feedback",
    };
    const nextTraits = [...traits, trait];
    setTraits(nextTraits);
    callChat(`(user tried "${taskText}" and felt ${mood === "good" ? "great" : "bad"} about it)`, {
      show: false,
      traits: nextTraits,
    });
  }

  function hideCareer(id: string) {
    const nextHidden = [...hidden, id];
    setHidden(nextHidden);
    // Inside a field there are few options: ask for more (the server pulls extra O*NET careers if needed).
    if (field && remaining.length - 1 < showCount) {
      const title = getCareer(id, field)?.title ?? id;
      callChat(`(user marked "${title}" as not for me; suggest other paths in this field)`, {
        show: false,
        hidden: nextHidden,
      });
      return;
    }
    // the next career in line slides into the freed spot: highlight it
    const newcomer = remaining.filter((r) => r.id !== id)[showCount - 1];
    if (newcomer) {
      setRising([newcomer.id]);
      setTimeout(() => setRising([]), 2000);
    }
  }
  const topFields = field
    ? []
    : (Array.from(new Set(visible.map((r) => getCareer(r.id, null)?.field).filter(Boolean))) as string[]).slice(0, 3);

  if (stage === "start") {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
        <div className="fixed top-4 right-4">
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <div className="max-w-3xl w-full text-center">
          <h1 className="text-3xl font-semibold">Career Navigator</h1>
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
        <div className="fixed top-4 right-4 z-10">
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <QuickTest lang={lang} onDone={finishTest} onSkip={() => setStage("chat")} />
      </>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="px-6 py-4 border-b bg-white flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Career Navigator</h1>
          <p className="text-sm text-slate-500">{t.chatTagline}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {saveStatus === "saving" ? t.saving : saveStatus === "neon" ? t.savedNeon : saveStatus === "local" ? t.savedLocal : ""}
          </span>
          <button onClick={startOver} className="text-xs text-slate-500 hover:text-slate-800 underline">
            {t.startOver}
          </button>
          <LangToggle lang={lang} setLang={setLang} />
        </div>
      </header>

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
            <h2 className="font-semibold mb-3">{t.aboutMe}</h2>
            <div className="mb-4">
              <div className="text-xs text-slate-500 mb-1">{t.myMajor}</div>
              <div className="flex flex-wrap gap-1.5">
                {FIELDS.map((f) => (
                  <button
                    key={f}
                    onClick={() => toggleMajor(f)}
                    disabled={loading}
                    className={`text-xs rounded-full px-3 py-1 border transition disabled:opacity-50 ${
                      majors.includes(f) ? "bg-slate-900 text-white border-slate-900" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {majors.includes(f) ? "✓ " : ""}
                    {fieldName(f, lang)}
                  </button>
                ))}
              </div>
              {majors.length === 0 && <p className="text-xs text-slate-400 mt-1">{t.noMajorYet}</p>}
            </div>
            {traits.length === 0 ? (
              <p className="text-sm text-slate-400">{t.aboutEmpty}</p>
            ) : (
              (Object.keys(TYPE_STYLE) as TraitType[]).map((type) => {
                const list = traits.filter((t) => t.type === type);
                if (!list.length) return null;
                return (
                  <div key={type} className="mb-3">
                    <div className="text-xs text-slate-500 mb-1">{t.types[type]}</div>
                    <div className="flex flex-wrap gap-2">
                      <AnimatePresence>
                        {list.map((t) => (
                          <motion.span
                            key={t.id}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            className={`text-sm border rounded-full px-3 py-1 ${TYPE_STYLE[type]}`}
                          >
                            {t.label}
                            <button
                              onClick={() => setTraits(traits.filter((x) => x.id !== t.id))}
                              className="ml-2 opacity-60 hover:opacity-100"
                            >
                              ×
                            </button>
                          </motion.span>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                );
              })
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
              onFeedback={onTaskFeedback}
              plan={plan}
              setPlan={setPlan}
            />
          ) : (
          <>
          <div className="bg-white rounded-2xl border p-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold">{field ? t.pathsInside(fieldName(field, lang)) : t.careersForYou}</h2>
              {field && (
                <button onClick={undo} className="text-sm text-blue-600">
                  {t.backAll}
                </button>
              )}
            </div>
            {field && <div className="text-xs text-slate-500 mb-3">{t.allCareers} › {fieldName(field, lang)}</div>}

            {topFields.length > 0 && (
              <div className="my-3">
                <div className="text-xs text-slate-500 mb-2">{t.fieldsFit}</div>
                <div className="flex flex-wrap gap-2">
                  {topFields.map((f) =>
                    subfields[f] ? (
                      <button
                        key={f}
                        onClick={() => confirmField(f)}
                        className="text-sm rounded-full px-3 py-1 bg-blue-600 text-white"
                      >
                        {t.confirm(fieldName(f, lang))}
                      </button>
                    ) : (
                      <span key={f} className="text-sm rounded-full px-3 py-1 border text-slate-500">
                        {fieldName(f, lang)}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {visible.length === 0 && (
              <p className="text-sm text-slate-400">
                {loading ? t.ranking : t.rankingEmpty}
              </p>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={field ?? "all"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-3"
              >
                {visible.map((r, i) => {
                  const c = getCareer(r.id, field)!;
                  return (
                    <motion.div
                      layout
                      key={r.id}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      className={`border rounded-xl p-4 ${
                        rising.includes(r.id) ? "ring-2 ring-emerald-300 bg-emerald-50" : "bg-white"
                      } ${liked[r.id] === "interested" ? "border-blue-400" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="text-lg font-semibold text-slate-400 w-6">{i + 1}</div>
                        <div className="flex-1">
                          <div className="flex justify-between items-center">
                            <h3 className="font-semibold">
                              {lang === "ko" && r.titleKo ? r.titleKo : c.title}
                              {lang === "ko" && r.titleKo && (
                                <span className="ml-2 text-xs font-normal text-slate-400">{c.title}</span>
                              )}
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
                          <p className="text-sm italic text-slate-700 mt-2">{r.reason}</p>
                          <div className="flex gap-2 mt-3">
                            {[
                              ["interested", t.interested],
                              ["maybe", t.maybe],
                            ].map(([k, l]) => (
                              <button
                                key={k}
                                onClick={() => markCareer(r, k, c)}
                                className={`text-xs border rounded-full px-3 py-1 ${
                                  liked[r.id] === k ? "bg-blue-600 text-white border-blue-600" : "text-slate-600"
                                }`}
                              >
                                {l}
                              </button>
                            ))}
                            <button
                              onClick={() => hideCareer(r.id)}
                              className="text-xs border rounded-full px-3 py-1 text-slate-600"
                            >
                              {t.notForMe}
                            </button>
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
            {remaining.length > visible.length && (
              <button
                onClick={() => setShowCount(showCount + 5)}
                className="mt-3 w-full text-sm text-slate-500 border border-dashed rounded-xl py-2 hover:bg-slate-50"
              >
                {t.showMore(remaining.length - visible.length)}
              </button>
            )}
          </div>
          <div className="bg-white rounded-2xl border p-4">
            <h2 className="font-semibold">{t.beyondTitle}</h2>
            {majors.length === 0 ? (
              <p className="text-sm text-slate-400 mt-2">{t.beyondHint}</p>
            ) : (
              <>
                <p className="text-xs text-slate-500 mt-1 mb-3">{t.beyondDesc(majors.map((m) => fieldName(m, lang)).join(lang === "ko" ? ", " : " & "))}</p>
                {beyond.length === 0 && (
                  <p className="text-sm text-slate-400">{loading ? t.ranking : t.beyondEmpty}</p>
                )}
                <div className="grid sm:grid-cols-3 gap-3">
                  {beyond.map((r) => {
                    const c = getCareer(r.id, null);
                    if (!c) return null;
                    return (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 flex flex-col"
                      >
                        <div className="text-xs text-violet-700">{c.field ? fieldName(c.field, lang) : ""}</div>
                        <h3 className="font-semibold text-sm mt-1">
                          {lang === "ko" && r.titleKo ? r.titleKo : c.title}
                        </h3>
                        <p className="text-xs italic text-slate-700 mt-2 flex-1">{r.reason}</p>
                        <button
                          onClick={() => setOpenCareer(r.id)}
                          className="mt-3 self-start text-xs rounded-full px-3 py-1 bg-slate-900 text-white"
                        >
                          {t.explore}
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          </>
          )}
        </section>
      </div>

      <footer className="text-center text-[11px] text-slate-400 pb-4">
        {t.footer}
      </footer>

      {openCareer && (
        <CareerDetail
          careerId={openCareer}
          field={field}
          traits={traits}
          lang={lang}
          onClose={() => setOpenCareer(null)}
        />
      )}
    </main>
  );
}