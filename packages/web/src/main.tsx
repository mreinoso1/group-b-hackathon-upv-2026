import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ChartGallery } from "./components/ChartGallery.tsx";
import "./styles.css";

const reviewCharts = window.location.hash === "#charts";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {reviewCharts ? (
      <div className="app">
        <ChartGallery />
      </div>
    ) : (
      <App />
    )}
  </StrictMode>,
);
