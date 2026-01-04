import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// IMPORTANT: initialize i18n once, before any components render
import "./i18n";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
