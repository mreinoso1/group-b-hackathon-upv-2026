import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AdvisorScreen } from "./components/Advisor.tsx";
import { ChartGallery } from "./components/ChartGallery.tsx";
import "./styles.css";

const reviewCharts = window.location.hash === "#charts";
// The advisor's side: /advisor/<caseId>
const advisorCase = window.location.pathname.match(/^\/advisor\/([a-z0-9-]+)\/?$/)?.[1];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {advisorCase ? (
      <AdvisorScreen caseId={advisorCase} />
    ) : reviewCharts ? (
      <div className="app">
        <ChartGallery />
      </div>
    ) : (
      <App />
    )}
  </StrictMode>,
);
