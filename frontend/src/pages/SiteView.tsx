import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getSite } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type SiteRecord = {
  id: number;
  name: string;
  location?: string | null;
};

type SiteKpi = {
  label: string;
  value: string;
  sublabel?: string;
};

type Opportunity = {
  id: number;
  title: string;
  impact: "High" | "Medium" | "Low";
  estSavings: string;
  status: string;
};

const SiteView: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  const [site, setSite] = useState<SiteRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mocked KPIs / trend / opportunities until we wire real analytics
  const kpis: SiteKpi[] = [
    {
      label: "Energy (Last 24h)",
      value: "32,100 kWh",
      sublabel: "+1.8% vs baseline",
    },
    {
      label: "CO₂ Emissions",
      value: "12.4 tCO₂e",
      sublabel: "-3.1% vs last week",
    },
    {
      label: "Active Opportunities",
      value: "3",
      sublabel: "1 high-impact action",
    },
  ];

  const opportunities: Opportunity[] = [
    {
      id: 1,
      title: "Weekend base load review",
      impact: "High",
      estSavings: "5–8% site-wide",
      status: "Open",
    },
    {
      id: 2,
      title: "Adjust HVAC schedules",
      impact: "Medium",
      estSavings: "3–5% electric",
      status: "In analysis",
    },
    {
      id: 3,
      title: "Update compressor controls",
      impact: "Medium",
      estSavings: "4–6% electric",
      status: "Open",
    },
  ];

  const trend = [
    { ts: "Mon", value: 90 },
    { ts: "Tue", value: 95 },
    { ts: "Wed", value: 110 },
    { ts: "Thu", value: 120 },
    { ts: "Fri", value: 130 },
    { ts: "Sat", value: 80 },
    { ts: "Sun", value: 75 },
  ];

  useEffect(() => {
    if (!id) {
      setError("Missing site id.");
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    getSite(id)
      .then((data) => {
        if (!isMounted) return;
        setSite(data as SiteRecord);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        if (e?.response?.status === 404) {
          setError("Site not found.");
        } else {
          setError(e?.message || "Failed to load site.");
        }
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-page">
        <div className="cei-card">
          <ErrorBanner message={error} onClose={() => {}} />
          <div
            style={{
              marginTop: "0.7rem",
              fontSize: "0.8rem",
            }}
          >
            <Link to="/sites" style={{ color: "var(--cei-text-accent)" }}>
              Back to sites list
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!site) {
    // Should not normally happen if no error, but be defensive
    return (
      <div className="dashboard-page">
        <div className="cei-card">
          <p style={{ fontSize: "0.85rem" }}>No site data available.</p>
        </div>
      </div>
    );
  }

  const siteName = site.name || `Site ${site.id}`;
  const siteLocation = site.location || "Unknown location";

  return (
    <div className="dashboard-page">
      {/* Header / breadcrumb */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.8rem",
              marginBottom: "0.2rem",
              color: "var(--cei-text-muted)",
            }}
          >
            <Link to="/sites" style={{ color: "var(--cei-text-accent)" }}>
              Sites
            </Link>{" "}
            / <span>{siteName}</span>
          </div>
          <h1
            style={{
              fontSize: "1.3rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {siteName}
          </h1>
          <p
            style={{
              marginTop: "0.25rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Location: {siteLocation}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="cei-btn cei-btn-ghost"
            onClick={() => {
              alert("Site edit flow not implemented yet.");
            }}
          >
            Edit site
          </button>
        </div>
      </section>

      {/* KPI row */}
      <section className="dashboard-row">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="cei-card">
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cei-text-muted)",
              }}
            >
              {kpi.label}
            </div>
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "1.25rem",
                fontWeight: 600,
              }}
            >
              {kpi.value}
            </div>
            {kpi.sublabel && (
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-accent)",
                }}
              >
                {kpi.sublabel}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Main grid: trend + opportunities */}
      <section className="dashboard-main-grid">
        {/* Trend card */}
        <div className="cei-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "0.7rem",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Site energy trend – last 7 days
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Once wired, this will show actual metered load for this site.
              </div>
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--cei-text-muted)",
              }}
            >
              kWh · daily
            </div>
          </div>

          <div
            style={{
              marginTop: "0.75rem",
              display: "flex",
              alignItems: "flex-end",
              gap: "0.5rem",
              height: "170px",
            }}
          >
            {trend.map((p) => {
              const max = Math.max(...trend.map((t) => t.value));
              const heightPct = (p.value / max) * 100;
              return (
                <div
                  key={p.ts}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: "0.35rem",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      borderRadius: "999px",
                      background:
                        "linear-gradient(to top, rgba(34, 197, 94, 0.9), rgba(34, 197, 94, 0.1))",
                      height: `${heightPct}%`,
                      boxShadow: "0 4px 12px rgba(34, 197, 94, 0.25)",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: "var(--cei-text-muted)",
                    }}
                  >
                    {p.ts}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Opportunities */}
        <div className="cei-card">
          <div style={{ marginBottom: "0.6rem" }}>
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Opportunities at this site
            </div>
            <div
              style={{
                marginTop: "0.2rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Items that could reduce energy use and CO₂ if implemented.
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
            {opportunities.map((opp) => (
              <div
                key={opp.id}
                style={{
                  borderRadius: "0.75rem",
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  background:
                    "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.7))",
                  padding: "0.6rem 0.7rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.85rem",
                      fontWeight: 500,
                    }}
                  >
                    {opp.title}
                  </div>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      padding: "0.15rem 0.55rem",
                      borderRadius: "999px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background:
                        opp.impact === "High"
                          ? "rgba(248, 113, 113, 0.18)"
                          : opp.impact === "Medium"
                          ? "rgba(234, 179, 8, 0.15)"
                          : "rgba(148, 163, 184, 0.18)",
                      color:
                        opp.impact === "High"
                          ? "#fecaca"
                          : opp.impact === "Medium"
                          ? "#facc15"
                          : "#e5e7eb",
                    }}
                  >
                    {opp.impact}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: "0.25rem",
                    fontSize: "0.78rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Est. savings: {opp.estSavings}
                </div>
                <div
                  style={{
                    marginTop: "0.2rem",
                    fontSize: "0.72rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Status:{" "}
                  <span style={{ color: "var(--cei-text-main)" }}>
                    {opp.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default SiteView;
