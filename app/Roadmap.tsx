"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { T, type Lang } from "./i18n";

type Career = { id: string; title: string; field?: string; summary: string; skills: string[]; titleKo?: string };
type Trait = { id: string; label: string; type: string; source: string };
type Label = "required" | "recommended" | "explore";
type Period = "week" | "semester" | "year";
type Task = { id: string; text: string; period: Period; scope: string; label: Label; why: string; evidence?: string | null };
type Mood = "good" | "ok" | "bad";
export type Plan = {
  tasks: Task[];
  done: Record<string, Mood | "pending">;
  dismissed: string[];
  evidenceFor: string[];
};
export const EMPTY_PLAN: Plan = { tasks: [], done: {}, dismissed: [], evidenceFor: [] };

const LABEL_STYLE: Record<Label, string> = {
  required: "bg-rose-50 text-rose-700 border-rose-200",
  recommended: "bg-blue-50 text-blue-700 border-blue-200",
  explore: "bg-violet-50 text-violet-700 border-violet-200",
};
const MOODS: Mood[] = ["good", "ok", "bad"];

export default function Roadmap({
  board,
  traits,
  majors,
  lang,
  titleOf,
  onRemove,
  onFeedback,
  plan,
  setPlan,
}: {
  board: Career[];
  traits: Trait[];
  majors: string[];
  lang: Lang;
  titleOf: (c: Career) => string;
  onRemove: (id: string) => void;
  onFeedback: (taskText: string, mood: Mood) => void;
  plan: Plan;
  setPlan: (p: Plan) => void;
}) {
  const t = T[lang];
  // Plan lives in the parent so it survives tab switches and gets saved.
  const { tasks, done, dismissed, evidenceFor } = plan;
  const setDone = (d: Plan["done"]) => setPlan({ ...plan, done: d });
  const setDismissed = (d: string[]) => setPlan({ ...plan, dismissed: d });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function makePlan() {
    setLoading(true);
    setError("");
    try {
      const completedTasks = tasks
        .filter((x) => done[x.id] && done[x.id] !== "pending")
        .map((x) => ({ text: x.text, felt: done[x.id] }));
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interestedCareers: board.map((c) => ({ id: c.id, title: c.title, summary: c.summary, skills: c.skills })),
          traits,
          majors,
          completedTasks,
          lang,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      // keep finished tasks visible, replace the rest
      const kept = tasks.filter((x) => done[x.id] && done[x.id] !== "pending");
      const keptDone: Plan["done"] = {};
      kept.forEach((k) => (keptDone[k.id] = done[k.id]));
      setPlan({
        tasks: [...kept, ...data.tasks.filter((n: Task) => !kept.some((k) => k.id === n.id))],
        done: keptDone,
        dismissed: [],
        evidenceFor: data.evidenceFor ?? [],
      });
    } catch (e) {
      console.error(e);
      setError(t.planError);
    } finally {
      setLoading(false);
    }
  }

  function pickMood(task: Task, mood: Mood) {
    setDone({ ...done, [task.id]: mood });
    onFeedback(task.text, mood);
  }

  const scopes = ["common", ...board.map((c) => c.id)];
  const live = tasks.filter((x) => !dismissed.includes(x.id) && scopes.includes(x.scope));
  const hasFeedback = Object.values(done).some((v) => v !== "pending");

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border p-4">
        <h2 className="font-semibold mb-3">{t.boardTitle}</h2>
        {board.length === 0 ? (
          <p className="text-sm text-slate-400">{t.boardEmpty}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {board.map((c) => (
                <span key={c.id} className="text-sm rounded-full px-3 py-1 bg-blue-50 text-blue-800 border border-blue-200">
                  {titleOf(c)}
                  <button onClick={() => onRemove(c.id)} className="ml-2 opacity-60 hover:opacity-100">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button
              onClick={makePlan}
              disabled={loading}
              className="mt-4 bg-blue-600 text-white rounded-xl px-4 py-2 text-sm disabled:opacity-50"
            >
              {loading ? t.planning : tasks.length && hasFeedback ? t.updatePlan : t.makePlan}
            </button>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </>
        )}
      </div>

      {live.length > 0 && (
        <div className="bg-white rounded-2xl border p-4 space-y-5">
          <p className="text-xs text-slate-500">🔒 {t.requiredNote}</p>
          <p className="text-xs text-slate-500">
            📊{" "}
            {evidenceFor.length
              ? t.evidenceUsed(
                  board
                    .filter((c) => evidenceFor.includes(c.id))
                    .map((c) => titleOf(c))
                    .join(", ")
                )
              : t.evidenceNone}
          </p>
          {(["week", "semester", "year"] as Period[]).map((period) => {
            const inPeriod = live.filter((x) => x.period === period);
            if (!inPeriod.length) return null;
            return (
              <div key={period}>
                <h3 className="text-sm font-semibold mb-2">{t.periods[period]}</h3>
                <div className="space-y-2">
                  <AnimatePresence>
                    {scopes.flatMap((scope) =>
                      inPeriod
                        .filter((x) => x.scope === scope)
                        .map((task) => {
                          const state = done[task.id];
                          const career = board.find((c) => c.id === scope);
                          return (
                            <motion.div
                              key={task.id}
                              layout
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                              className={`border rounded-xl p-3 ${state && state !== "pending" ? "bg-slate-50" : "bg-white"}`}
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={!!state}
                                  onChange={(e) => {
                                    const next = { ...done };
                                    if (e.target.checked) next[task.id] = "pending";
                                    else delete next[task.id];
                                    setDone(next);
                                  }}
                                  className="mt-1 h-4 w-4 accent-blue-600"
                                />
                                <div className="flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className={`text-[11px] border rounded-full px-2 py-0.5 ${LABEL_STYLE[task.label]}`}>
                                      {task.label === "required" ? "🔒 " : ""}
                                      {t.labels[task.label]}
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                      {scope === "common" ? t.common : career ? titleOf(career) : ""}
                                    </span>
                                    {task.evidence && task.evidence !== "null" && (
                                      <span className="text-[11px] rounded-full px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200">
                                        📊 LinkedIn {task.evidence}
                                      </span>
                                    )}
                                  </div>
                                  <p
                                    className={`text-sm mt-1 ${
                                      state && state !== "pending" ? "line-through text-slate-400" : "text-slate-800"
                                    }`}
                                  >
                                    {task.text}
                                  </p>
                                  <p className="text-xs text-slate-500 mt-0.5">{task.why}</p>
                                  {state === "pending" && (
                                    <div className="mt-2">
                                      <div className="text-xs text-slate-500 mb-1">{t.howFelt}</div>
                                      <div className="flex gap-2">
                                        {MOODS.map((m) => (
                                          <button
                                            key={m}
                                            onClick={() => pickMood(task, m)}
                                            className="text-xs border rounded-full px-3 py-1 text-slate-600 hover:bg-slate-50"
                                          >
                                            {t.moods[m]}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {state && state !== "pending" && (
                                    <span className="mt-2 inline-block text-xs rounded-full px-3 py-1 bg-blue-600 text-white">
                                      {t.moods[state]}
                                    </span>
                                  )}
                                </div>
                                {task.label !== "required" && !state && (
                                  <button
                                    onClick={() => setDismissed([...dismissed, task.id])}
                                    className="text-slate-300 hover:text-slate-600"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            </motion.div>
                          );
                        })
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
