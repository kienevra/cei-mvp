import React from "react";
import LoadingSpinner from "../components/LoadingSpinner";

type Kpi = {
  label: string;
  value: string;
  sublabel?: string;
};

const mockKpis: Kpi[] = [
  {
    label: "Total Energy (Last 24h)",
    value: "128,400 kWh",
    sublabel: "+3.2% vs baseline",
  },
  {
    label: "Estimated CO₂ Emissions",
    value: "52.1 tCO₂e",
    sublabel: "-7.4% vs last week",
  },
  {
    label: "Active Opportunities",
    value: "7",
    sublabel: "3 high-impact actions",
  },
];

const mockOpportunities = [
  {
    id: 1,
    title: "Optimize compressed air system",
    site: "Plant A",
    impact: "High",
    estSavings: "12–15% kWh in area",
    status: "Open",
  },
  {
    id: 2,
    title: "Night-time base load review",
    site: "Plant B",
    impact: "Medium",
    estSavings: "5–7% site-wide",
    status: "Open",
  },
  {
    id: 3,
    title: "Boiler scheduling optimization",
    site: "Plant C",
    impact: "High",
    estSavings: "8–10% gas use",
    status: "In analysis",
  },
];

const mockTrend = [
  { ts: "00:00", value: 210 },
  { ts: "04:00", value: 190 },
  { ts: "08:00", value: 260 },
  { ts: "12:00", value: 310 },
  { ts: "16:00", value: 295 },
  { ts: "20:00", value: 280 },
  { ts: "23:59", value: 230 },
];

const Dashboard: React.FC = () => {
  // Hooks for when we wire real API later
  const loading = false;
  const error: string | null = null;

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
      <div style={{ padding: "1rem" }}>
        <div
          style={{
            borderRadius: "0.75rem",
            border: "1px solid rgba(248, 113, 113, 0.5)",
            background: "rgba(127, 29, 29, 0.3)",
            padding: "0.9rem 1rem",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
            Dashboard failed to load
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      {/* Header */}
      <section>
        <h1
          style={{
            fontSize: "1.4rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Carbon Efficiency Intelligence
        </h1>
        <p
          style={{
            marginTop: "0.4rem",
            fontSize: "0.85rem",
            color: "var(--cei-text-muted)",
            maxWidth: "40rem",
          }}
        >
          Portfolio-wide view of energy use, emissions, and efficiency
          opportunities across your industrial sites.
        </p>
      </section>

      {/* KPI row */}
      <section className="dashboard-row">
        {mockKpis.map((kpi) => (
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
                marginTop: "0.4rem",
                fontSize: "1.3rem",
                fontWeight: 600,
              }}
            >
              {kpi.value}
            </div>
            {kpi.sublabel && (
              <div
                style={{
                  marginTop: "0.25rem",
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

      {/* Main layout: trend + opportunities */}
      <section className="dashboard-main-grid">
        {/* Trend / timeseries placeholder */}
        <div className="cei-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "0.75rem",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Energy trend – last 24 hours
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Placeholder mini-chart. We’ll wire this to real timeseries data
                and your TimeSeriesChart component.
              </div>
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--cei-text-muted)",
              }}
            >
              All sites · kWh
            </div>
          </div>

          {/* Simple bar strip to visually break up the page until we plug a real chart */}
          <div
            style={{
              marginTop: "0.75rem",
              display: "flex",
              alignItems: "flex-end",
              gap: "0.4rem",
              height: "160px",
            }}
          >
            {mockTrend.map((p) => {
              const max = Math.max(...mockTrend.map((t) => t.value));
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
                    gap: "0.3rem",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      borderRadius: "999px",
                      background:
                        "linear-gradient(to top, rgba(56, 189, 248, 0.9), rgba(56, 189, 248, 0.1))",
                      height: `${heightPct}%`,
                      boxShadow: "0 4px 12px rgba(56, 189, 248, 0.25)",
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

        {/* Opportunities list */}
        <div className="cei-card">
          <div style={{ marginBottom: "0.6rem" }}>
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Efficiency opportunities
            </div>
            <div
              style={{
                marginTop: "0.2rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Ranked by estimated energy and CO₂ savings potential.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
            {mockOpportunities.map((opp) => (
              <div
                key={opp.id}
                style={{
                  borderRadius: "0.75rem",
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  background:
                    "linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.6))",
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
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.78rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  <span>{opp.site}</span>
                  <span>{opp.estSavings}</span>
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

export default Dashboard;
