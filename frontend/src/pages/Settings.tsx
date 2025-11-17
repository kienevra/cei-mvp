import React, { useState } from "react";

const Settings: React.FC = () => {
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [unitSystem, setUnitSystem] = useState<"metric" | "imperial">("metric");

  return (
    <div className="dashboard-page">
      <section>
        <h1
          style={{
            fontSize: "1.3rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Settings
        </h1>
        <p
          style={{
            marginTop: "0.3rem",
            fontSize: "0.85rem",
            color: "var(--cei-text-muted)",
          }}
        >
          Local preferences for your CEI experience. We’ll connect these to
          server-side settings later.
        </p>
      </section>

      <section className="dashboard-row">
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
            }}
          >
            Notifications
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={emailAlerts}
              onChange={(e) => setEmailAlerts(e.target.checked)}
              style={{ width: "auto" }}
            />
            <span style={{ fontSize: "0.85rem" }}>
              Email me when new high-impact opportunities are detected.
            </span>
          </label>
        </div>

        <div className="cei-card">
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
            }}
          >
            Units
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            Choose how energy and emissions metrics are displayed.
          </div>
          <div
            style={{
              marginTop: "0.6rem",
              display: "flex",
              gap: "0.5rem",
            }}
          >
            <button
              type="button"
              className="cei-btn"
              style={{
                borderColor:
                  unitSystem === "metric"
                    ? "rgba(34, 197, 94, 0.5)"
                    : "rgba(156, 163, 175, 0.4)",
                background:
                  unitSystem === "metric"
                    ? "rgba(22, 163, 74, 0.25)"
                    : "transparent",
              }}
              onClick={() => setUnitSystem("metric")}
            >
              Metric (kWh, tCO₂e)
            </button>
            <button
              type="button"
              className="cei-btn"
              style={{
                borderColor:
                  unitSystem === "imperial"
                    ? "rgba(34, 197, 94, 0.5)"
                    : "rgba(156, 163, 175, 0.4)",
                background:
                  unitSystem === "imperial"
                    ? "rgba(22, 163, 74, 0.25)"
                    : "transparent",
              }}
              onClick={() => setUnitSystem("imperial")}
            >
              Imperial (kBtu, lb CO₂)
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Settings;
