import { useEffect, useState } from "react";
import { api, request, type CaseSummary } from "../api.ts";
import { joinUrl, newRoom } from "../room.ts";
import "./advisor.css";

/**
 * Stand-in for the demo page (components/Demo.tsx, with the QR codes) while it isn't there:
 * the same links as plain text. Pick a family, get a room, open each person's link.
 */
export function DemoFallback() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [origin, setOrigin] = useState(window.location.origin);
  const [picked, setPicked] = useState<{ c: CaseSummary; room: string } | null>(null);

  useEffect(() => {
    void api.cases().then((r) => setCases(r.cases));
    // Phones can't open "localhost": prefer this machine's Wi-Fi address.
    void request<{ urls: string[] }>("/api/network").then((r) => r.urls[0] && setOrigin(r.urls[0]), () => undefined);
  }, []);

  return (
    <div className="advisor-page">
      <h1>Demo</h1>
      {!picked ? (
        <ul>
          {cases.map((c) => (
            <li key={c.id}>
              <button className="link" onClick={() => setPicked({ c, room: newRoom() })}>
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p>
            {picked.c.label} · room <strong>{picked.room}</strong>
          </p>
          <ul>
            {[...picked.c.members.map((m) => ({ id: m.id, name: m.name })), ...(picked.c.members.length > 1 ? [{ id: "together", name: "Together" }] : [])].map((m) => {
              const url = joinUrl(origin, picked.c.id, m.id, picked.room);
              return (
                <li key={m.id}>
                  {m.name}: <a href={url}>{url}</a>
                </li>
              );
            })}
          </ul>
          <p>
            Advisor: <a href={`/advisor/${picked.c.id}?room=${picked.room}`}>{`/advisor/${picked.c.id}?room=${picked.room}`}</a>
          </p>
          <button className="link" onClick={() => setPicked(null)}>
            Another family
          </button>
        </>
      )}
    </div>
  );
}
