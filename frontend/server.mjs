import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Heroku provides PORT
const PORT = process.env.PORT || 3000;

// Paths
const distPath = path.join(__dirname, "dist");
const indexFile = path.join(distPath, "index.html");

const app = express();

// This frontend is *not* an API server
app.use("/api", (req, res) => {
  res.status(404).send("This app only serves the CEI frontend. Backend API is at https://cei-mvp.onrender.com");
});

// Static assets (JS, CSS, images, etc.)
app.use(
  express.static(distPath, {
    index: "index.html",
    maxAge: "0",
  })
);

// SPA fallback: any unknown route -> index.html
app.get("*", (req, res) => {
  res.sendFile(indexFile);
});

app.listen(PORT, () => {
  console.log(`CEI frontend listening on port ${PORT}`);
});