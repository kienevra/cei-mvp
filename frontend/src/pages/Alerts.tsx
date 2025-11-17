import React from "react";

const Alerts: React.FC = () => {
  const alerts: any[] = []; // placeholder; will be wired to real data later

  const hasAlerts = alerts.length > 0;

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
          Alerts
        </h1>
        <p
          style={{
            marginTop: "0.3rem",
            fontSize: "0.85rem",
            color: "var(--cei-text-muted)",
          }}
        >
          Notifications about abnormal energy use, anomalies, and new efficiency
          opportunities.
        </p>
      </section>

      <section>
        <div className="cei-card">
          <div
            style={{
              marginBottom: "0.5rem",
              fontSize: "0.9rem",
              fontWeight: 600,
            }}
          >
            Recent alerts
          </div>

          {hasAlerts ? (
            <div>Alerts list coming soon.</div>
          ) : (
            <div
              style={{
                padding: "0.8rem 0.2rem 0.3rem",
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              There are no alerts yet. Once CEI detects anomalies or
              high-priority events, they’ll show up here.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Alerts;
