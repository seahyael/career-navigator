"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import careersData from "@/data/careers.json";
import subfieldsData from "@/data/subfields.json";

type TraitType = "strength" | "interest" | "value" | "dislike";
type Trait = { id: string; label: string; type: TraitType; source: string };
type Rank = { id: string; score: number; reason: string };
type Career = { id: string; title: string; field?: string; summary: string; skills: string[] };
type Msg = { role: "user" | "coach"; text: string };

const careers = careersData as unknown as Career[];
const subfields = subfieldsData as unknown as Record<string, Career[]>;

const TYPE_LABEL: Record<TraitType, string> = {
  strength: "Strengths",
  interest: "Interests",
  value: "Values",
  dislike: "Not for me",
};
const TYPE_STYLE: Record<TraitType, string> = {
  strength: "bg-blue-50 text-blue-700 border-blue-200",
  interest: "bg-violet-50 text-violet-700 border-violet-200",
  value: "bg-emerald-50 text-emerald-700 border-emerald-200",
  dislike: "bg-gray-100 text-gray-600 border-gray-200",
};

const SAMPLE_TRAITS: Trait[] = [
  { id: "s1", label: "coding", type: "strength", source: "sample" },
  { id: "s2", label: "Computer Science major", type: "interest", source: "sample" },
  { id: "s3", label: "visual design", type: "interest", source: "sample" },
  { id: "s4", label: "working with people", type: "value", source: "sample" },
];

const HINTS = ["I'm good at...", "I lose track of time when...", "I hate..."];

function getCareer(id: string, field: string | null) {
  const list = field ? subfields[field] ?? [] : careers;
  return list.find((c) => c.id === id);
}

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "coach",
      text: "Hi! Tell me anything about you: what you like, what you're good at, even your 'useless' talents. I'll find careers that fit.",
    },
  ]);
  const [input, setInput] = useState("");
  const [traits, setTraits] = useState<Trait[]>([]);
  const [ranking, setRanking] = useState<Rank[]>([]);
  const [field, setField] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [liked, setLiked] = useState<Record<string, string>>({});
  const [rising, setRising] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function callChat(
    message: string,
    opts: { show?: boolean; field?: string | null; traits?: Trait[] } = {}
  ) {
    const show = opts.show ?? true;
    const useField = opts.field !== undefined ? opts.field : field;
    const useTraits = opts.traits ?? traits;
    if (show) setMessages((m) => [...m, { role: "user", text: message }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, traits: useTraits, confirmedField: useField }),
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

      const replies: Msg[] = [];
      if (data.reply) replies.push({ role: "coach", text: data.reply });
      if (data.followUp) replies.push({ role: "coach", text: data.followUp });
      setMessages((m) => [...m, ...replies]);
    } catch (e) {
      console.error(e);
      setMessages((m) => [...m, { role: "coach", text: "Hmm, I got a little lost. Tell me a bit more?" }]);
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
    setHidden([]);
    setRanking([]);
    callChat(`(user confirmed the field: ${f})`, { show: false, field: f });
  }

  function undo() {
    setField(null);
    setHidden([]);
    setRanking([]);
    callChat("(user went back to all careers)", { show: false, field: null });
  }

  function loadSample() {
    setTraits(SAMPLE_TRAITS);
    setMessages((m) => [
      ...m,
      { role: "user", text: "(Sample student: CS major who codes, loves visual design and people)" },
    ]);
    callChat("(sample student profile loaded)", { show: false, traits: SAMPLE_TRAITS });
  }

  const visible = ranking.filter((r) => !hidden.includes(r.id) && getCareer(r.id, field));
  const topFields = field
    ? []
    : (Array.from(new Set(visible.map((r) => getCareer(r.id, null)?.field).filter(Boolean))) as string[]).slice(0, 3);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="px-6 py-4 border-b bg-white">
        <h1 className="text-xl font-semibold">Career Navigator</h1>
        <p className="text-sm text-slate-500">Tests ask you questions once. We listen all the time.</p>
      </header>

      <div className="grid md:grid-cols-5 gap-4 p-4 max-w-7xl mx-auto">
        {/* Chat */}
        <section className="md:col-span-2 bg-white rounded-2xl border flex flex-col h-[80vh]">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
            {loading && <div className="text-sm text-slate-400">Coach is thinking…</div>}
            {traits.length === 0 && !loading && (
              <button onClick={loadSample} className="text-sm text-blue-600 underline">
                Try a sample student
              </button>
            )}
            <div ref={endRef} />
          </div>
          <div className="px-3 pt-2 flex flex-wrap gap-2">
            {HINTS.map((h) => (
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
              placeholder="Say anything... what you like, what you're good at, who you are"
              className="flex-1 border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              onClick={send}
              disabled={loading}
              className="bg-blue-600 text-white rounded-xl px-4 text-sm disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </section>

        {/* Results */}
        <section className="md:col-span-3 space-y-4 md:h-[80vh] md:overflow-y-auto">
          <div className="bg-white rounded-2xl border p-4">
            <h2 className="font-semibold mb-3">About me</h2>
            {traits.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing yet. Just start talking!</p>
            ) : (
              (Object.keys(TYPE_LABEL) as TraitType[]).map((type) => {
                const list = traits.filter((t) => t.type === type);
                if (!list.length) return null;
                return (
                  <div key={type} className="mb-3">
                    <div className="text-xs text-slate-500 mb-1">{TYPE_LABEL[type]}</div>
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

          <div className="bg-white rounded-2xl border p-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold">{field ? `Paths inside ${field}` : "Careers for you"}</h2>
              {field && (
                <button onClick={undo} className="text-sm text-blue-600">
                  ← All careers
                </button>
              )}
            </div>
            {field && <div className="text-xs text-slate-500 mb-3">All careers › {field}</div>}

            {topFields.length > 0 && (
              <div className="my-3">
                <div className="text-xs text-slate-500 mb-2">Fields that fit you</div>
                <div className="flex flex-wrap gap-2">
                  {topFields.map((f) =>
                    subfields[f] ? (
                      <button
                        key={f}
                        onClick={() => confirmField(f)}
                        className="text-sm rounded-full px-3 py-1 bg-blue-600 text-white"
                      >
                        Confirm {f}
                      </button>
                    ) : (
                      <span key={f} className="text-sm rounded-full px-3 py-1 border text-slate-500">
                        {f}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {visible.length === 0 && (
              <p className="text-sm text-slate-400">
                {loading ? "Ranking careers…" : "Your ranked careers will show up here."}
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
                            <h3 className="font-semibold">{c.title}</h3>
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
                              ["interested", "Interested"],
                              ["maybe", "Maybe"],
                            ].map(([k, l]) => (
                              <button
                                key={k}
                                onClick={() => setLiked({ ...liked, [r.id]: k })}
                                className={`text-xs border rounded-full px-3 py-1 ${
                                  liked[r.id] === k ? "bg-blue-600 text-white border-blue-600" : "text-slate-600"
                                }`}
                              >
                                {l}
                              </button>
                            ))}
                            <button
                              onClick={() => setHidden([...hidden, r.id])}
                              className="text-xs border rounded-full px-3 py-1 text-slate-600"
                            >
                              Not for me
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
        </section>
      </div>
    </main>
  );
}