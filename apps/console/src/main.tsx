import "./design-system/tokens/console-theme.css";
import "./console-layout.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { ConsoleApp } from "./app-shell.js";
import { ConsoleProvider } from "./context/ConsoleContext.js";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <BrowserRouter>
        <ConsoleProvider>
          <ConsoleApp />
        </ConsoleProvider>
      </BrowserRouter>
    </StrictMode>
  );
}
