"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { T, type Lang } from "./i18n";

type Area = "Realistic" | "Investigative" | "Artistic" | "Social" | "Enterprising" | "Conventional";
type Trait = { id: string; label: string; type: "strength" | "interest" | "value" | "dislike"; source: string };

const QUESTIONS: { area: Area; text: string; ko: string }[] = [
  { area: "Artistic", text: "Design how something looks", ko: "무언가의 겉모습을 디자인하기" },
  { area: "Social", text: "Help a friend through a problem", ko: "고민 있는 친구를 도와주기" },
  { area: "Investigative", text: "Figure out how something works", ko: "어떤 것이 어떻게 작동하는지 알아내기" },
  { area: "Enterprising", text: "Lead a team or a project", ko: "팀이나 프로젝트를 이끌기" },
  { area: "Realistic", text: "Build or fix things with your hands", ko: "손으로 무언가를 만들거나 고치기" },
  { area: "Conventional", text: "Organize files, schedules or data", ko: "파일, 일정, 데이터를 정리하기" },
  { area: "Social", text: "Teach or explain things to others", ko: "다른 사람에게 가르치거나 설명하기" },
  { area: "Artistic", text: "Write, draw, make music or videos", ko: "글쓰기, 그림, 음악이나 영상 만들기" },
  { area: "Enterprising", text: "Pitch an idea and convince people", ko: "아이디어를 발표하고 사람들을 설득하기" },
  { area: "Investigative", text: "Solve tricky puzzles or problems", ko: "까다로운 퍼즐이나 문제 풀기" },
  { area: "Conventional", text: "Follow clear steps to get things exactly right", ko: "정해진 절차대로 정확하게 일 처리하기" },
  { area: "Realistic", text: "Work with tools, machines or outdoors", ko: "도구나 기계를 다루거나 야외에서 일하기" },
];

const AREA_INFO: Record<Area, { name: string; trait: string; nameKo: string; traitKo: string; emoji: string }> = {
  Realistic: { name: "Doer", trait: "hands-on building and fixing", nameKo: "실천가", traitKo: "손으로 만들고 고치기", emoji: "🔧" },
  Investigative: { name: "Thinker", trait: "analyzing and solving problems", nameKo: "탐구가", traitKo: "분석하고 문제 해결하기", emoji: "🔬" },
  Artistic: { name: "Creator", trait: "creating and designing", nameKo: "창작가", traitKo: "창작하고 디자인하기", emoji: "🎨" },
  Social: { name: "Helper", trait: "helping and teaching people", nameKo: "조력가", traitKo: "사람을 돕고 가르치기", emoji: "🤝" },
  Enterprising: { name: "Persuader", trait: "leading and persuading", nameKo: "설득가", traitKo: "이끌고 설득하기", emoji: "📣" },
  Conventional: { name: "Organizer", trait: "organizing and getting details right", nameKo: "조직가", traitKo: "정리하고 꼼꼼하게 챙기기", emoji: "🗂️" },
};

const OPTIONS = [
  { v: 1, emoji: "😩" },
  { v: 2, emoji: "🙁" },
  { v: 3, emoji: "😐" },
  { v: 4, emoji: "🙂" },
  { v: 5, emoji: "😍" },
];

export default function QuickTest({
  onDone,
  onSkip,
  lang,
}: {
  onDone: (traits: Trait[], top: string[]) => void;
  onSkip: () => void;
  lang: Lang;
}) {
  const t = T[lang];
  const ko = lang === "ko";
  const nm = (a: Area) => (ko ? AREA_INFO[a].nameKo : AREA_INFO[a].name);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const done = answers.length === QUESTIONS.length;

  function answer(v: number) {
    setAnswers([...answers, v]);
    if (idx < QUESTIONS.length - 1) setIdx(idx + 1);
  }

  const scores = (Object.keys(AREA_INFO) as Area[])
    .map((area) => ({
      area,
      score: QUESTIONS.reduce((sum, q, i) => (q.area === area ? sum + (answers[i] ?? 0) : sum), 0),
    }))
    .sort((a, b) => b.score - a.score);

  function finish() {
    const top = scores.slice(0, 2).map((s) => s.area);
    const traits: Trait[] = top.map((area) => ({
      id: `riasec-${area}`,
      label: ko ? AREA_INFO[area].traitKo : AREA_INFO[area].trait,
      type: "interest",
      source: `Interest test: ${area}`,
    }));
    const bottom = scores[scores.length - 1];
    if (bottom.score <= 4) {
      traits.push({
        id: `riasec-low-${bottom.area}`,
        label: ko ? AREA_INFO[bottom.area].traitKo : AREA_INFO[bottom.area].trait,
        type: "dislike",
        source: `Interest test: ${bottom.area}`,
      });
    }
    onDone(traits, top.map((a) => `${nm(a)} (${a})`));
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white border rounded-2xl p-8">
        {!done ? (
          <>
            <div className="flex justify-between text-sm text-slate-500">
              <span>{t.testTitle}</span>
              <span>
                {idx + 1} / {QUESTIONS.length}
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full mt-2">
              <motion.div
                className="h-1.5 bg-blue-500 rounded-full"
                animate={{ width: `${(answers.length / QUESTIONS.length) * 100}%` }}
              />
            </div>
            <p className="text-sm text-slate-500 mt-8">{t.testAsk}</p>
            <motion.h2
              key={idx}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-2xl font-semibold mt-2"
            >
              {ko ? QUESTIONS[idx].ko : QUESTIONS[idx].text}
            </motion.h2>
            <div className="grid grid-cols-5 gap-2 mt-8">
              {OPTIONS.map((o) => (
                <button
                  key={o.v}
                  onClick={() => answer(o.v)}
                  className="border rounded-xl py-3 hover:bg-blue-50 hover:border-blue-300 transition"
                >
                  <div className="text-2xl">{o.emoji}</div>
                  <div className="text-xs text-slate-500 mt-1">{t.options[o.v - 1]}</div>
                </button>
              ))}
            </div>
            <button onClick={onSkip} className="text-sm text-slate-400 mt-6 underline">
              {t.testSkip}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500">{t.testProfile}</p>
            <h2 className="text-2xl font-semibold mt-1">
              {t.testYouAre(nm(scores[0].area), nm(scores[1].area))}{" "}
              {AREA_INFO[scores[0].area].emoji}
              {AREA_INFO[scores[1].area].emoji}
            </h2>
            <div className="space-y-3 mt-6">
              {scores.map((s, i) => (
                <div key={s.area}>
                  <div className="flex justify-between text-sm">
                    <span className={i < 2 ? "font-semibold" : "text-slate-500"}>
                      {AREA_INFO[s.area].emoji} {nm(s.area)} ({s.area})
                    </span>
                    <span className="text-slate-500">{s.score} / 10</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full mt-1">
                    <motion.div
                      className={`h-2 rounded-full ${i < 2 ? "bg-blue-500" : "bg-slate-300"}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${s.score * 10}%` }}
                      transition={{ delay: i * 0.1 }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-4">{t.testBasis}</p>
            <button onClick={finish} className="w-full mt-6 bg-blue-600 text-white rounded-xl py-3 font-medium">
              {t.testGo}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
