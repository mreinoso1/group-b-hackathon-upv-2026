// Dev review page (open /#charts): every chart of every family, standard and simple,
// so chart bugs show up across all four cases at once.
import { useEffect, useState } from "react";
import { api, type Capsule, type CaseSummary } from "../api.ts";
import { Chart } from "../charts/Chart.tsx";

export function ChartGallery() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [capsules, setCapsules] = useState<Capsule[]>([]);

  useEffect(() => {
    api.cases().then((r) => {
      setCases(r.cases);
      setCaseId(r.cases[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!caseId) return;
    void (async () => {
      const { topics } = await api.topics(caseId);
      const out: Capsule[] = [];
      for (const t of topics) {
        if (!t.hasChart) continue;
        out.push(await api.capsule(caseId, t.id, "standard", "together"));
        out.push(await api.capsule(caseId, t.id, "simple", "together"));
      }
      setCapsules(out);
    })();
  }, [caseId]);

  return (
    <section className="gallery">
      <h1>Chart review</h1>
      <div className="gallery-tabs">
        {cases.map((c) => (
          <button key={c.id} className={c.id === caseId ? "primary" : "link"} onClick={() => setCaseId(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {capsules.map((c) => (
        <div key={c.id} className="capsule gallery-item" data-topic={c.topicId} data-level={c.level}>
          <p className="muted">
            {c.topicId} · {c.level}
          </p>
          {c.chart ? <Chart spec={c.chart} simple={c.level === "simple"} /> : <p>No chart</p>}
        </div>
      ))}
    </section>
  );
}
