import { useEffect, useState } from "react";
import { advisorApi } from "../api-advisor.ts";
import type { CaseSummary } from "../api.ts";
import "./advisor.css";
import { GuideBot } from "./Guide.tsx";

/**
 * Asked once per person, after Summit says hello and before the first idea: share how it went with the advisor, or not.
 * Reading together, each partner answers for themselves. Already answered: skipped.
 */
export function ConsentScreen({ household, member, onDone }: { household: CaseSummary; member: string; onDone: () => void }) {
  const people = member === "together" ? household.members : household.members.filter((m) => m.id === member);
  const [choice, setChoice] = useState<Record<string, boolean | null> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    advisorApi.consent(household.id).then(
      (r) => {
        if (people.every((p) => r.consent[p.id] !== null && r.consent[p.id] !== undefined)) onDone();
        else setChoice(r.consent);
      },
      // If the choice can't be loaded, don't block reading: nothing is shared without a yes.
      () => onDone(),
    );
  }, [household.id, member]);

  if (!choice) return <p className="muted">Loading…</p>;

  const decide = async (id: string, share: boolean) => {
    try {
      await advisorApi.setConsent(household.id, id, share);
      const next = { ...choice, [id]: share };
      setChoice(next);
      if (people.every((p) => next[p.id] !== null && next[p.id] !== undefined)) onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const couple = household.members.length > 1;
  return (
    <section className="consent">
      <div className="consent-guide">
        <GuideBot size={46} />
        <p>One quick question before we start.</p>
      </div>
      <h1>Share how this went with your advisor?</h1>
      <p className="lede">Your advisor sees it before you meet, so the meeting starts where you are instead of from the top.</p>
      <div className="consent-lists">
        <div>
          <h2>What they see</h2>
          <ul>
            <li>Where you got lost, and which explanation helped</li>
            <li>What you wanted to know more about</li>
            <li>The first step you pick, its date, and your check-ins</li>
            {couple ? <li>How you each ordered the priorities, only if you both share</li> : null}
          </ul>
        </div>
        <div>
          <h2>What they don't</h2>
          <ul>
            <li>How long you spent on each idea</li>
            <li>Anything at all, if you say no</li>
          </ul>
        </div>
      </div>
      <p className="muted small">A question you send to your advisor always reaches them, even if you say no here.</p>
      {error ? <p className="error">{error}</p> : null}
      {people.map((p) =>
        choice[p.id] === null || choice[p.id] === undefined ? (
          <div key={p.id} className="consent-choice">
            {people.length > 1 ? <p className="consent-name">{p.name}</p> : null}
            <button className="primary" onClick={() => decide(p.id, true)}>
              Yes, share it
            </button>
            <button className="ghost" onClick={() => decide(p.id, false)}>
              Not now
            </button>
          </div>
        ) : (
          <p key={p.id} className="consent-done">
            ✓ {p.name}: {choice[p.id] ? "sharing with the advisor" : "not sharing"}
          </p>
        ),
      )}
    </section>
  );
}
