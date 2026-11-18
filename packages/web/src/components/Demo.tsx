// The demo page (/demo), for Demo Day: pick a family, get a room, and each judge scans the QR of the
// person they want to be. Everything they tap stays in that room; the advisor screen shows that room.
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api, request, type CaseSummary } from "../api.ts";
import { joinUrl, newRoom, roomFrom } from "../room.ts";
import "./demo.css";
import { CasePeak, GuideBot } from "./Guide.tsx";

interface Network {
  urls: string[];
  listening: boolean;
}

/** A QR code as an image. */
function Qr({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: "M", color: { dark: "#15161a", light: "#ffffff" } }).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [url]);
  return src ? <img className="qr" src={src} alt={`QR code: ${label}`} /> : <div className="qr" aria-hidden="true" />;
}


/** True for a published address (not localhost, not a private network address like 192.168.x.x). */
export function isPublicHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".local") || host === "::1" || host === "[::1]") return false;
  return !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host);
}

export function DemoPage() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [net, setNet] = useState<Network | null>(null);
  const [pick, setPick] = useState<{ caseId: string; room: string } | null>(() => {
    // The room lives in the address, so a reload keeps it: /demo?case=…&room=…
    const q = new URLSearchParams(window.location.search);
    const room = roomFrom(window.location.search);
    const caseId = q.get("case");
    return caseId && room ? { caseId, room } : null;
  });
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.cases().then(
      (r) => setCases(r.cases),
      (e: Error) => setError(e.message),
    );
    request<Network>("/api/network").then(setNet, () => setNet({ urls: [], listening: false }));
  }, []);

  useEffect(() => {
    const search = pick ? `?case=${pick.caseId}&room=${pick.room}` : "";
    window.history.replaceState(null, "", `/demo${search}`);
  }, [pick]);

  // Published on the web (a public address): the codes use that address, and any phone can open them.
  // On a laptop, phones can't open "localhost": the codes use this laptop's Wi-Fi address.
  const hosted = isPublicHost(window.location.hostname);
  const origin = hosted ? window.location.origin : (net?.urls[0] ?? window.location.origin);
  const reachable = hosted || Boolean(net?.listening && net.urls.length);
  const household = pick && cases?.find((c) => c.id === pick.caseId);

  const choose = (c: CaseSummary) => {
    setNote(null);
    setPick({ caseId: c.id, room: newRoom() });
  };

  const reset = async () => {
    if (!pick) return;
    setConfirming(false);
    try {
      const r = await request<{ removed: number }>(`/api/cases/${encodeURIComponent(pick.caseId)}/reset?room=${pick.room}`, { method: "POST" });
      setNote(`Room ${pick.room} started over: ${r.removed} recorded event${r.removed === 1 ? "" : "s"} deleted.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="demo-page">
      <header className="demo-head">
        <p className="demo-brand">
          Future You<span className="brand-dot">.</span>
        </p>
        <div className="demo-title">
          <GuideBot size={64} waving />
          <h1>Try it on your phone</h1>
        </div>
        <p className="demo-lede">
          Scan a code with your phone's camera and open the plan as that person.{hosted ? "" : " Your phone and this laptop need to be on the same Wi-Fi."}
        </p>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {net && !reachable ? (
        <p className="demo-warning" role="alert">
          {net.urls.length
            ? "Phones can't open these codes yet: start the app with npm run demo (not npm run dev)."
            : "This laptop isn't on a Wi-Fi network, so phones can't reach it. Connect it to the same Wi-Fi as the phones, or share a phone's mobile data."}
        </p>
      ) : null}

      {!household ? (
        <section aria-label="Pick a family">
          <h2>Pick a family</h2>
          {!cases ? <p className="muted">Loading families…</p> : null}
          <ul className="demo-families">
            {cases?.map((c) => (
              <li key={c.id}>
                <button className="demo-family" onClick={() => choose(c)}>
                  <CasePeak score={c.score} />
                  <span className="demo-family-name">{c.label}</span>
                  <span className="muted">
                    Score {c.score} · {c.city}, {c.state}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section aria-label={`${household.label}, room ${pick!.room}`}>
          <div className="demo-room">
            <div>
              <h2>{household.label}</h2>
              <p className="demo-room-code">
                Room <strong>{pick!.room}</strong>
              </p>
            </div>
            <div className="demo-actions">
              <a className="primary demo-advisor" href={`/advisor/${household.id}?room=${pick!.room}`} target="_blank" rel="noreferrer">
                Open the advisor screen
              </a>
              <button className="ghost" onClick={() => choose(household)}>
                New room
              </button>
              {confirming ? (
                <span className="demo-confirm">
                  Delete what was tapped in room {pick!.room}?
                  <button className="ghost danger" onClick={reset}>
                    Yes, start over
                  </button>
                  <button className="link" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="ghost" onClick={() => setConfirming(true)}>
                  Reset this room
                </button>
              )}
              <button className="link" onClick={() => setPick(null)}>
                Another family
              </button>
            </div>
          </div>
          {note ? (
            <p className="demo-note" role="status">
              {note}
            </p>
          ) : null}

          <ul className="demo-codes">
            {[
              ...household.members.map((m) => ({ id: m.id, name: m.name, sub: `Open the plan as ${m.name}`, faces: [m.id] })),
              ...(household.members.length > 1
                ? [{ id: "together", name: "Together", sub: "Both of you, on one phone", faces: household.members.map((m) => m.id) }]
                : []),
            ].map((p) => {
              const url = joinUrl(origin, household.id, p.id, pick!.room);
              return (
                <li key={p.id} className="demo-code">
                  <span className="demo-initials" aria-hidden="true">
                    {p.faces.map((id) => (
                      <span key={id}>{household.members.find((m) => m.id === id)?.name[0] ?? "?"}</span>
                    ))}
                  </span>
                  <h3>{p.name}</h3>
                  <p className="muted">{p.sub}</p>
                  <Qr url={url} label={`${p.name}, room ${pick!.room}`} />
                  <a className="demo-url" href={url} target="_blank" rel="noreferrer">
                    {url.replace(/^https?:\/\//, "")}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
