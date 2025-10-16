import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

import "./index.css"; // if you have Tailwind / CSS; if not, remove this line

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App />);
