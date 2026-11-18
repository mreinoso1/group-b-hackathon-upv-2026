import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AdvisorPicker, AdvisorScreen } from "./components/Advisor.tsx";
import { ChartGallery } from "./components/ChartGallery.tsx";
import { DemoPage } from "./components/Demo.tsx";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/fraunces/opsz-italic.css";
import "./styles.css";

const { pathname, hash } = window.location;
const reviewCharts = hash === "#charts";
// The advisor's side: /advisor/<caseId>
const advisorCase = pathname.match(/^\/advisor\/([a-z0-9-]+)\/?$/)?.[1];
// The demo page: a QR code per person, for Demo Day
const isDemo = /^\/demo\/?$/.test(pathname);
// /advisor alone: pick a family
const isAdvisorList = /^\/advisor\/?$/.test(pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {advisorCase ? (
      <AdvisorScreen caseId={advisorCase} />
    ) : isAdvisorList ? (
      <AdvisorPicker />
    ) : isDemo ? (
      <DemoPage />
    ) : reviewCharts ? (
      <div className="app">
        <ChartGallery />
      </div>
    ) : (
      <App />
    )}
  </StrictMode>,
);
