import "./design-system/tokens/console-theme.css";
import "./design-system/primitives/controls.css";
import "./design-system/domain-surfaces.css";
import "./console-layout.css";
import "./pages/workspaces.css";
import "./webchat/webchat.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { ConsoleApp } from "./app-shell.js";
import { ConsoleProvider } from "./context/ConsoleContext.js";

const rootEl = document.getElementById("root");
if (rootEl) {
  const router = createBrowserRouter([{
    path: "*",
    element: <ConsoleProvider><ConsoleApp /></ConsoleProvider>
  }]);
  createRoot(rootEl).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
