import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import axios from "axios";

// Base URL logic
const getBaseUrl = () => {
  try {
    const buildUrl =
      (import.meta && import.meta.env && import.meta.env.VITE_API_URL) ||
      (import.meta && import.meta.env && import.meta.env.NEXT_PUBLIC_API_URL);
    if (buildUrl) return buildUrl.replace(/\/+$/, "");
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.location) {
      return `${window.location.origin}/api/v1`;
    }
  } catch (_) {}
  const nodeEnvUrl =
    typeof process !== "undefined" &&
    process.env &&
    (process.env.VITE_API_URL || process.env.NEXT_PUBLIC_API_URL);
  if (nodeEnvUrl) return nodeEnvUrl.replace(/\/+$/, "");
  return "http://localhost:8000/api/v1";
};

const API_BASE = getBaseUrl();
const api = axios.create({ baseURL: API_BASE, timeout: 10000 });

function TopNav() {
  return (
    <header style={{ padding: 12, borderBottom: "1px solid #eee", marginBottom: 16 }}>
      <nav style={{ display: "flex", gap: 12 }}>
        <Link to="/">Dashboard</Link>
        <Link to="/sites/1">Site: Example</Link>
        <a href={API_BASE.replace(/\/+$/, "")} target="_blank" rel="noreferrer">
          API Base
        </a>
      </nav>
    </header>
  );
}

function HealthIndicator() {
  const [state, setState] = useState({ loading: true, ok: false, message: "" });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.get("/health");
        if (!mounted) return;
        setState({
          loading: false,
          ok: res?.data?.status === "ok",
          message: JSON.stringify(res?.data),
        });
      } catch (err) {
        if (!mounted) return;
        setState({
          loading: false,
          ok: false,
          message: err?.message || "fetch error",
        });
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div style={{ marginBottom: 12 }}>
      <strong>Backend health:</strong>{" "}
      {state.loading ? (
        "checking..."
      ) : state.ok ? (
        <span style={{ color: "green" }}>OK</span>
      ) : (
        <span style={{ color: "red" }}>Down</span>
      )}
      <div style={{ marginTop: 6, color: "#666", fontSize: 13 }}>{state.message}</div>
    </div>
  );
}

function Dashboard() {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api
      .get("/sites")
      .then((r) => {
        if (!mounted) return;
        setSites(Array.isArray(r.data) ? r.data : r.data?.items ?? []);
      })
      .catch(() => {
        if (!mounted) return;
        setSites([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Carbon Efficiency Intelligence — CEI</h1>
      <HealthIndicator />
      <section style={{ marginTop: 12 }}>
        <h2>Sites</h2>
        {loading ? (
          <div>Loading sites…</div>
        ) : !sites || sites.length === 0 ? (
          <div>No sites found. (This demo expects GET /sites — safe to ignore.)</div>
        ) : (
          <ul>
            {sites.map((s) => (
              <li key={s.id || s.name}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/sites/${s.id || encodeURIComponent(s.name)}`);
                  }}
                >
                  {s.name || `Site ${s.id}`}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer style={{ marginTop: 24, color: "#666", fontSize: 13 }}>
        <div>App built in a single file for quick recovery. Move UI back to modules when ready.</div>
      </footer>
    </div>
  );
}

function SiteView() {
  const { id } = useParams();
  const [site, setSite] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api
      .get(`/sites/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!mounted) return;
        setSite(r.data);
      })
      .catch(() => {
        if (!mounted) return;
        setSite(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Site view: {id}</h1>
      <HealthIndicator />
      {loading ? (
        <div>Loading…</div>
      ) : site ? (
        <div>
          <pre style={{ background: "#f7f7f7", padding: 12 }}>
            {JSON.stringify(site, null, 2)}
          </pre>
        </div>
      ) : (
        <div>Site not found or backend returned an error.</div>
      )}
      <p>
        <Link to="/">← Back to dashboard</Link>
      </p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <TopNav />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sites/:id" element={<SiteView />} />
        <Route
          path="*"
          element={
            <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
              <h2>Not found</h2>
              <p>
                <Link to="/">Go home</Link>
              </p>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}