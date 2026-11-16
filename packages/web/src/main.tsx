import { lazy, StrictMode, Suspense, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AdvisorScreen } from "./components/Advisor.tsx";
import { ChartGallery } from "./components/ChartGallery.tsx";
import { DemoFallback } from "./components/DemoFallback.tsx";
import "./styles.css";

const { pathname, hash } = window.location;
const reviewCharts = hash === "#charts";
// The advisor's side: /advisor/<caseId>
const advisorCase = pathname.match(/^\/advisor\/([a-z0-9-]+)\/?$/)?.[1];
// The demo page: components/Demo.tsx (QR codes per person) when it exists, otherwise plain links.
const isDemo = /^\/demo\/?$/.test(pathname);
const demoModule = Object.values(import.meta.glob<{ DemoPage: ComponentType }>("./components/Demo.tsx"))[0];
const Demo = lazy(async () => ({ default: demoModule ? (await demoModule()).DemoPage : DemoFallback }));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {advisorCase ? (
      <AdvisorScreen caseId={advisorCase} />
    ) : isDemo ? (
      <Suspense fallback={null}>
        <Demo />
      </Suspense>
    ) : reviewCharts ? (
      <div className="app">
        <ChartGallery />
      </div>
    ) : (
      <App />
    )}
  </StrictMode>,
);
