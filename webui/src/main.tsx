import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "./app-context";
import App from "./App";
import "./styles.css";
import { Router } from "./router";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <AppProvider><App /></AppProvider>
    </Router>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
