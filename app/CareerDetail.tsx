"use client";
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { T, type Lang } from "./i18n";

type Trait = { id: string; label: string; type: string; source: string };
type Detail = {
  title: string;
  code: string | null;
  onet: boolean;
  onetNote: string | null;
  sourceUrl: string | null;
  overview?: string;
  tasks?: string[];
  strengthsMatch?: { trait: string; why: string }[];
  gaps?: { skill: string; howToStart: string }[];
  majors?: string[];
  industries?: string[];
  education?: string | null;
  outlook?: string | null;
  nextSteps?: { stage: string; action: string }[];
  experiment?: string;
  titleKo?: string;
  error?: string;
};

export default function CareerDetail({
  careerId,
  field,
  traits,
  lang,
  onClose,
}: {
  careerId: string;
  field: string | null;
  traits: Trait[];
  lang: Lang;
  onClose: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const t = T[lang];

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch("/api/career", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ careerId, field, traits, lang }),
    })
      .then((r) => r.json())
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setData({ error: String(e) } as Detail));
    return () => {
      cancelled = true;
    };
    // traits are read once when the panel opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerId, field, lang]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <motion.aside
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 32 }}
        className="relative w-full max-w-lg h-full bg-white shadow-xl overflow-y-auto p-6 text-slate-900"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-xl">
          ×
        </button>

        {!data && (
          <div className="mt-10 space-y-3">
            <div className="text-sm text-slate-500">{t.loadingDetail}</div>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        )}

        {data?.error && <p className="mt-10 text-sm text-red-600">{t.loadError}{data.error}</p>}

        {data && !data.error && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold pr-8">{lang === "ko" && data.titleKo ? data.titleKo : data.title}</h2>
              {lang === "ko" && data.titleKo && <div className="text-sm text-slate-500">{data.title}</div>}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {data.onet ? (
                  <a
                    href={data.sourceUrl ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200"
                  >
                    ✓ {t.onetBadge} · {data.code} ↗
                  </a>
                ) : (
                  <span
                    title={data.onetNote ?? ""}
                    className="rounded-full px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200"
                  >
                    {t.onetMissing}
                  </span>
                )}
              </div>
              {data.overview && <p className="mt-3 text-slate-700">{data.overview}</p>}
            </div>

            {!!data.tasks?.length && (
              <Section title={t.onTheJob}>
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                  {data.tasks.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </Section>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Section title={t.yourStrengths}>
                {data.strengthsMatch?.length ? (
                  <ul className="space-y-2 text-sm">
                    {data.strengthsMatch.map((s) => (
                      <li key={s.trait}>
                        <span className="inline-block rounded-full px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs">
                          {s.trait}
                        </span>
                        <p className="text-slate-600 mt-1">{s.why}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-400">{t.noStrengths}</p>
                )}
              </Section>
              <Section title={t.skillsToBuild}>
                <ul className="space-y-2 text-sm">
                  {data.gaps?.map((g) => (
                    <li key={g.skill}>
                      <span className="font-medium">{g.skill}</span>
                      <p className="text-slate-600">{g.howToStart}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>

            {!!data.nextSteps?.length && (
              <Section title={t.yourPath}>
                <ol className="relative border-l-2 border-blue-100 ml-2 space-y-4">
                  {data.nextSteps.map((s) => (
                    <li key={s.stage} className="ml-4">
                      <span className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-blue-500" />
                      <div className="text-xs font-semibold text-blue-700">{s.stage}</div>
                      <div className="text-sm text-slate-700">{s.action}</div>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            <MarketSection careerId={careerId} title={data.title} traits={traits} lang={lang} />

            {data.experiment && (
              <div className="rounded-xl bg-violet-50 border border-violet-200 p-4 text-sm">
                <div className="font-semibold text-violet-800">{t.tryThis}</div>
                <p className="text-violet-900 mt-1">{data.experiment}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              {!!data.majors?.length && (
                <Section title={t.majors}>
                  <p className="text-slate-700">{data.majors.join(", ")}</p>
                </Section>
              )}
              {!!data.industries?.length && (
                <Section title={t.industries}>
                  <p className="text-slate-700">{data.industries.join(", ")}</p>
                </Section>
              )}
              {data.education && (
                <Section title={t.education}>
                  <p className="text-slate-700">{data.education}</p>
                </Section>
              )}
              {data.outlook && (
                <Section title={t.outlook}>
                  <p className="text-slate-700">{data.outlook}</p>
                </Section>
              )}
            </div>

            <p className="text-[11px] text-slate-400">
              This site incorporates information from O*NET Web Services by the U.S. Department of Labor, Employment
              and Training Administration (USDOL/ETA). O*NET® is a trademark of USDOL/ETA.
            </p>
          </div>
        )}
      </motion.aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</h3>
      {children}
    </div>
  );
}

type Market = {
  postingsCount?: number;
  salary?: { min: number; max: number; n: number } | null;
  samples?: { title?: string; company?: string; url?: string }[];
  skills?: { name: string; count: number; have: boolean }[];
  degrees?: { name: string; count: number }[];
  certifications?: { name: string; count: number }[];
  experience?: string;
  focusNow?: string[];
  error?: string;
};

function MarketSection({
  careerId,
  title,
  traits,
  lang,
}: {
  careerId: string;
  title: string;
  traits: Trait[];
  lang: Lang;
}) {
  const t = T[lang];
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [m, setM] = useState<Market>({});

  async function scan() {
    setState("loading");
    try {
      const res = await fetch("/api/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, title, traits, lang }),
      });
      setM(await res.json());
    } catch (e) {
      setM({ error: String(e) });
    }
    setState("done");
  }

  const max = Math.max(1, ...(m.skills ?? []).map((s) => s.count));

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-800">{t.marketTitle}</h3>
      <p className="text-xs text-slate-500 mt-1">{t.marketDesc}</p>

      {state === "idle" && (
        <button onClick={scan} className="mt-3 text-sm rounded-xl px-4 py-2 bg-sky-700 text-white">
          {t.marketButton}
        </button>
      )}
      {state === "loading" && <p className="mt-3 text-sm text-slate-500 animate-pulse">{t.marketLoading}</p>}
      {state === "done" && m.error && <p className="mt-3 text-sm text-red-600">{m.error}</p>}

      {state === "done" && !m.error && (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-slate-500">{t.marketFrom(m.postingsCount ?? 0)}</p>

          {!!m.skills?.length && (
            <div className="space-y-1.5">
              {m.skills.map((s) => (
                <div key={s.name}>
                  <div className="flex justify-between text-xs">
                    <span className={s.have ? "text-emerald-700 font-medium" : "text-slate-800"}>
                      {s.have ? "✓ " : ""}
                      {s.name}
                    </span>
                    <span className="text-slate-500">
                      {s.count}/{m.postingsCount} · {s.have ? t.youHave : t.toBuild}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white rounded-full mt-0.5">
                    <motion.div
                      className={`h-1.5 rounded-full ${s.have ? "bg-emerald-500" : "bg-sky-500"}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${(s.count / max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!!m.focusNow?.length && (
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">🎯 {t.focusNow}</div>
              <div className="flex flex-wrap gap-1.5">
                {m.focusNow.map((f) => (
                  <span key={f} className="text-xs rounded-full px-2 py-1 bg-white border border-sky-200 text-sky-800">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            {!!m.degrees?.length && (
              <div>
                <div className="font-semibold text-slate-700 mb-1">{t.degrees}</div>
                {m.degrees.slice(0, 3).map((d) => (
                  <div key={d.name} className="text-slate-600">
                    {d.name} ({d.count})
                  </div>
                ))}
              </div>
            )}
            {!!m.certifications?.length && (
              <div>
                <div className="font-semibold text-slate-700 mb-1">{t.certs}</div>
                {m.certifications.slice(0, 3).map((d) => (
                  <div key={d.name} className="text-slate-600">
                    {d.name} ({d.count})
                  </div>
                ))}
              </div>
            )}
            {m.salary && (
              <div>
                <div className="font-semibold text-slate-700 mb-1">{t.salary}</div>
                <div className="text-slate-600">
                  ${Math.round(m.salary.min / 1000)}k – ${Math.round(m.salary.max / 1000)}k
                </div>
              </div>
            )}
          </div>

          {m.experience && <p className="text-xs text-slate-600">{m.experience}</p>}

          {!!m.samples?.length && (
            <div className="text-xs">
              <div className="font-semibold text-slate-700 mb-1">{t.samplePostings}</div>
              {m.samples.map((p, i) => (
                <a
                  key={i}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sky-700 hover:underline truncate"
                >
                  {p.title} · {p.company} ↗
                </a>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-400">Job data via Bright Data.</p>
        </div>
      )}
    </div>
  );
}
