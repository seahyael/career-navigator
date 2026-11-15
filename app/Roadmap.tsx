"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { T, type Lang } from "./i18n";

export type Career = {
  id: string;
  title: string;
  field?: string;
  summary: string;
  skills: string[];
  titleKo?: string;
  onetCode?: string;
  parentId?: string;
};
type Trait = { id: string; label: string; type: string; source: string };
type Label = "required" | "recommended" | "explore";
type Task = { id: string; text: string; label: Label; why: string; careers?: string[]; evidence?: string | null };
export type DecisionOption = { label: string; careerId?: string; title?: string; summary?: string; skills?: string[] };
export type Decision = {
  id: string;
  question: string;
  why: string;
  kind: "career" | "specialization" | "major" | "field";
  options: DecisionOption[];
};
type Stage = {
  id: string;
  title: string;
  when: string;
  goal: string;
  milestone: string;
  tasks: Task[];
  decision?: Decision | null;
};
type PathData = {
  summary: string;
  stages: Stage[];
  sources: { onet: boolean; linkedin: boolean; linkedinFor: string[] };
  builtAt: string;
};
export type Mood = "good" | "ok" | "bad";
export type DoneItem = { taskId: string; text: string; mood: Mood; at: string };
export type DecisionMade = { decisionId: string; question: string; kind: string; choice: string; careerId?: string; at: string };
export type Plan = { path: PathData | null; done: DoneItem[]; decisions: DecisionMade[]; stale: boolean };
export const EMPTY_PLAN: Plan = { path: null, done: [], decisions: [], stale: false };

export type Timeline = {
  status: string;
  gradTerm: string;
  gradYear: number | null;
  calendar: "semester" | "quarter";
  hoursPerWeek: number;
};
export const EMPTY_TIMELINE: Timeline = { status: "", gradTerm: "", gradYear: null, calendar: "semester", hoursPerWeek: 5 };

const LABEL_STYLE: Record<Label, string> = {
  required: "bg-rose-50 text-rose-700 border-rose-200",
  recommended: "bg-blue-50 text-blue-700 border-blue-200",
  explore: "bg-violet-50 text-violet-700 border-violet-200",
};
const MOODS: Mood[] = ["good", "ok", "bad"];
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 7 }, (_, i) => THIS_YEAR + i);

export default function Roadmap({
  board,
  traits,
  majors,
  field,
  lang,
  titleOf,
  onRemove,
  onOpen,
  onFeedback,
  onDecide,
  plan,
  setPlan,
  timeline,
  setTimeline,
}: {
  board: Career[];
  traits: Trait[];
  majors: string[];
  field: string | null;
  lang: Lang;
  titleOf: (c: Career) => string;
  onRemove: (id: string) => void;
  onOpen: (c: Career) => void;
  onFeedback: (taskText: string, mood: Mood) => void;
  onDecide: (d: Decision, o: DecisionOption) => void;
  plan: Plan;
  setPlan: (p: Plan) => void;
  timeline: Timeline;
  setTimeline: (t: Timeline) => void;
}) {
  const t = T[lang];
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState<string | null>(null);

  const path = plan.path;
  const doneIds = new Set(plan.done.map((d) => d.taskId));
  const careerName = (id: string) => {
    const c = board.find((b) => b.id === id);
    return c ? titleOf(c) : null;
  };

  async function build() {
    setBuilding(true);
    setError("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          careers: board,
          traits,
          majors,
          field,
          timeline,
          completedTasks: plan.done.map((d) => ({ text: d.text, felt: d.mood })),
          decisions: plan.decisions.map((d) => ({ question: d.question, kind: d.kind, choice: d.choice })),
          lang,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      setPlan({ ...plan, path: { ...data, builtAt: new Date().toISOString() }, stale: false });
    } catch (e) {
      console.warn("roadmap build failed:", e);
      setError(t.planError);
    } finally {
      setBuilding(false);
    }
  }

  function finishTask(task: Task, mood: Mood) {
    setChecking(null);
    setPlan({ ...plan, done: [{ taskId: task.id, text: task.text, mood, at: new Date().toISOString() }, ...plan.done] });
    onFeedback(task.text, mood); // the coach asks "what part?" in the chat
  }

  const select = "border rounded-lg px-2 py-1 text-sm bg-white text-slate-800";

  return (
    <div className="space-y-4">
      {/* Timeline */}
      <div className="bg-white rounded-2xl border p-4">
        <h2 className="font-semibold">{t.timelineTitle}</h2>
        <p className="text-xs text-slate-500 mb-3">{t.timelineHint}</p>
        <div className="grid sm:grid-cols-2 gap-3 text-xs text-slate-600">
          <label className="flex flex-col gap-1">
            {t.statusLabel}
            <select value={timeline.status} onChange={(e) => setTimeline({ ...timeline, status: e.target.value })} className={select}>
              {Object.keys(t.statuses).map((k) => (
                <option key={k} value={k}>
                  {t.statuses[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {t.gradLabel}
            <div className="flex gap-2">
              <select
                value={timeline.gradTerm}
                onChange={(e) => setTimeline({ ...timeline, gradTerm: e.target.value })}
                className={select}
              >
                {Object.keys(t.terms).map((k) => (
                  <option key={k} value={k}>
                    {t.terms[k]}
                  </option>
                ))}
              </select>
              <select
                value={timeline.gradYear ?? ""}
                onChange={(e) => setTimeline({ ...timeline, gradYear: e.target.value ? Number(e.target.value) : null })}
                className={select}
              >
                <option value="">—</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="flex flex-col gap-1">
            {t.calendarLabel}
            <select
              value={timeline.calendar}
              onChange={(e) => setTimeline({ ...timeline, calendar: e.target.value as Timeline["calendar"] })}
              className={select}
            >
              {Object.keys(t.calendars).map((k) => (
                <option key={k} value={k}>
                  {t.calendars[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {t.hoursLabel}: <span className="font-semibold text-slate-800">{timeline.hoursPerWeek}h</span>
            <input
              type="range"
              min={1}
              max={20}
              value={timeline.hoursPerWeek}
              onChange={(e) => setTimeline({ ...timeline, hoursPerWeek: Number(e.target.value) })}
              className="accent-blue-600"
            />
          </label>
        </div>
      </div>

      {/* Board */}
      <div className="bg-white rounded-2xl border p-4">
        <h2 className="font-semibold">{t.boardTitle}</h2>
        {board.length === 0 ? (
          <p className="text-sm text-slate-400 mt-2">{t.boardEmpty}</p>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-3">{t.boardNote}</p>
            <div className="flex flex-wrap gap-2">
              {board.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-2 text-sm rounded-full pl-3 pr-1 py-1 bg-blue-50 text-blue-800 border border-blue-200"
                >
                  {titleOf(c)}
                  <button
                    onClick={() => onOpen(c)}
                    className="text-[11px] rounded-full px-2 py-0.5 bg-white border border-blue-200 hover:bg-blue-100"
                  >
                    {t.details}
                  </button>
                  <button onClick={() => onRemove(c.id)} className="px-1 opacity-60 hover:opacity-100">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Roadmap */}
      {board.length > 0 && (
        <div className="bg-white rounded-2xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">🗺️ {t.tabRoadmap}</h2>
            <button
              onClick={build}
              disabled={building}
              className={`rounded-xl px-4 py-2 text-sm text-white disabled:opacity-50 ${
                plan.stale ? "bg-amber-500 animate-pulse" : "bg-blue-600"
              }`}
            >
              {building ? "…" : path ? t.rebuildRoadmap : t.buildRoadmap}
            </button>
          </div>
          {plan.stale && path && !building && <p className="text-xs text-amber-700 mt-2">{t.staleNote}</p>}
          {building && <p className="text-sm text-slate-500 mt-3 animate-pulse">{t.building}</p>}
          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

          {path && !building && (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-slate-700">{path.summary}</p>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {path.sources.onet && (
                  <span className="rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200">
                    ✓ {t.sourceOnet}
                  </span>
                )}
                {path.sources.linkedin && (
                  <span className="rounded-full px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200">
                    📊 LinkedIn: {path.sources.linkedinFor.map((id) => careerName(id) ?? id).join(", ")}
                  </span>
                )}
                {!path.sources.onet && !path.sources.linkedin && (
                  <span className="rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">
                    {t.sourceNone}
                  </span>
                )}
              </div>
              {!path.sources.linkedin && <p className="text-xs text-slate-500">{t.noLinkedinTip}</p>}
              <p className="text-xs text-slate-500">🔒 {t.requiredNote}</p>

              <ol className="relative border-l-2 border-blue-100 ml-2 space-y-6">
                {path.stages.map((st, i) => {
                  const open = st.tasks.filter((x) => !doneIds.has(x.id));
                  const made = st.decision ? plan.decisions.find((d) => d.decisionId === st.decision!.id) : undefined;
                  return (
                    <li key={st.id} className="ml-5">
                      <span
                        className={`absolute -left-[9px] mt-1 w-4 h-4 rounded-full border-2 border-white ${
                          open.length ? "bg-blue-500" : "bg-emerald-500"
                        }`}
                      />
                      <div className="text-xs font-semibold text-blue-700">
                        {t.stepLabel(i + 1)} · {st.when}
                      </div>
                      <div className="font-semibold text-sm">{st.title}</div>
                      <p className="text-xs text-slate-600">{st.goal}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        🏁 {t.milestone} {st.milestone}
                      </p>

                      <div className="mt-2 space-y-2">
                        {open.length === 0 && st.tasks.length > 0 && (
                          <p className="text-xs text-emerald-700">{t.stageDone}</p>
                        )}
                        <AnimatePresence>
                          {open.map((task) => (
                            <motion.div
                              key={task.id}
                              layout
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, x: 40 }}
                              className="border rounded-xl p-3 bg-white"
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={checking === task.id}
                                  onChange={(e) => setChecking(e.target.checked ? task.id : null)}
                                  className="mt-1 h-4 w-4 accent-blue-600"
                                />
                                <div className="flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className={`text-[11px] border rounded-full px-2 py-0.5 ${LABEL_STYLE[task.label]}`}>
                                      {task.label === "required" ? "🔒 " : ""}
                                      {t.labels[task.label]}
                                    </span>
                                    {task.evidence && task.evidence !== "null" && (
                                      <span className="text-[11px] rounded-full px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200">
                                        📊 {task.evidence}
                                      </span>
                                    )}
                                    {(task.careers ?? []).map((cid) => (
                                      <span key={cid} className="text-[11px] text-slate-500">
                                        {cid === "all" ? t.forAll : careerName(cid) ?? ""}
                                      </span>
                                    ))}
                                  </div>
                                  <p className="text-sm mt-1 text-slate-800">{task.text}</p>
                                  <p className="text-xs text-slate-500 mt-0.5">{task.why}</p>
                                  {checking === task.id && (
                                    <div className="mt-2">
                                      <div className="text-xs text-slate-500 mb-1">{t.howFelt}</div>
                                      <div className="flex gap-2">
                                        {MOODS.map((m) => (
                                          <button
                                            key={m}
                                            onClick={() => finishTask(task, m)}
                                            className="text-xs border rounded-full px-3 py-1 text-slate-600 hover:bg-slate-50"
                                          >
                                            {t.moods[m]}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>

                        {st.decision && (
                          <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-3">
                            <div className="text-[11px] font-semibold text-amber-800">🔀 {t.decisionTitle}</div>
                            <p className="text-sm font-medium text-slate-800 mt-1">{st.decision.question}</p>
                            <p className="text-xs text-slate-600 mt-0.5">{st.decision.why}</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {st.decision.options.map((o) => (
                                <button
                                  key={o.label}
                                  onClick={() => onDecide(st.decision!, o)}
                                  className={`text-xs rounded-full px-3 py-1 border ${
                                    made?.choice === o.label
                                      ? "bg-amber-500 text-white border-amber-500"
                                      : "bg-white text-slate-700 hover:bg-amber-100"
                                  }`}
                                >
                                  {o.label}
                                </button>
                              ))}
                            </div>
                            {made && (
                              <p className="text-xs text-amber-800 mt-2">
                                {t.decided} <b>{made.choice}</b>
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Done */}
      <div className="bg-white rounded-2xl border p-4">
        <h2 className="font-semibold mb-2">✅ {t.doneTitle(plan.done.length)}</h2>
        {plan.done.length === 0 ? (
          <p className="text-sm text-slate-400">{t.doneEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {plan.done.map((d) => (
              <li key={d.taskId + d.at} className="flex flex-wrap items-center gap-2 text-sm border rounded-xl px-3 py-2 bg-slate-50">
                <span className="flex-1 text-slate-700">{d.text}</span>
                <span className="text-[11px] rounded-full px-2 py-0.5 bg-blue-600 text-white">{t.moods[d.mood]}</span>
                <span className="text-[11px] text-slate-400">{d.at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
