import React, { useState, useEffect } from "react";
import api from "../services/api";

type IntegrationToken = {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
};

const Settings: React.FC = () => {
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [unitSystem, setUnitSystem] = useState<"metric" | "imperial">("metric");

  // Integration tokens state
  const [tokens, setTokens] = useState<IntegrationToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);

  const [newTokenName, setNewTokenName] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [createdTokenSecret, setCreatedTokenSecret] = useState<string | null>(
    null
  );
  const [revokingId, setRevokingId] = useState<number | null>(null);

  useEffect(() => {
    loadIntegrationTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadIntegrationTokens = async () => {
    setTokensLoading(true);
    setTokensError(null);
    try {
      const resp = await api.get<IntegrationToken[]>("/auth/integration-tokens");
      setTokens(resp.data || []);
    } catch (err: any) {
      console.error("Failed to load integration tokens", err);
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to load integration tokens.";
      setTokensError(msg);
    } finally {
      setTokensLoading(false);
    }
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName.trim()) {
      return;
    }
    setCreatingToken(true);
    setTokensError(null);
    setCreatedTokenSecret(null);
    try {
      const resp = await api.post<IntegrationToken & { token?: string }>(
        "/auth/integration-tokens",
        { name: newTokenName.trim() }
      );
      // Backend returns the raw token only once in `token`
      if (resp.data.token) {
        setCreatedTokenSecret(resp.data.token);
      } else {
        setCreatedTokenSecret(null);
      }
      setNewTokenName("");
      await loadIntegrationTokens();
    } catch (err: any) {
      console.error("Failed to create integration token", err);
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to create integration token.";
      setTokensError(msg);
    } finally {
      setCreatingToken(false);
    }
  };

  const handleRevokeToken = async (id: number) => {
    setRevokingId(id);
    setTokensError(null);
    try {
      await api.delete(`/auth/integration-tokens/${id}`);
      await loadIntegrationTokens();
    } catch (err: any) {
      console.error("Failed to revoke integration token", err);
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to revoke integration token.";
      setTokensError(msg);
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopySecret = async () => {
    if (!createdTokenSecret) return;
    try {
      await navigator.clipboard.writeText(createdTokenSecret);
      // no toast system here; silently succeed
    } catch (e) {
      console.warn("Clipboard copy failed", e);
    }
  };

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
          <label
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
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

      <section className="dashboard-row">
        <div className="cei-card" style={{ width: "100%" }}>
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
            }}
          >
            Integration tokens
          </div>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              marginBottom: "0.75rem",
            }}
          >
            Long-lived API tokens for SCADA/BMS/historian systems to push
            timeseries data directly into CEI via{" "}
            <code style={{ fontSize: "0.75rem" }}>
              POST /api/v1/timeseries/batch
            </code>
            .
          </p>

          {tokensError && (
            <div
              className="cei-pill-danger"
              style={{
                marginBottom: "0.6rem",
                fontSize: "0.8rem",
              }}
            >
              {tokensError}
            </div>
          )}

          <form
            onSubmit={handleCreateToken}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              marginBottom: "0.75rem",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              placeholder="e.g. SCADA Plant 4"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              style={{
                flex: "1 1 200px",
                minWidth: "0",
                padding: "0.4rem 0.6rem",
                borderRadius: "0.375rem",
                border: "1px solid rgba(156, 163, 175, 0.4)",
                backgroundColor: "rgba(15, 23, 42, 0.8)",
                color: "var(--cei-text)",
                fontSize: "0.85rem",
              }}
            />
            <button
              type="submit"
              className="cei-btn"
              disabled={creatingToken}
              style={{
                whiteSpace: "nowrap",
                opacity: creatingToken ? 0.7 : 1,
              }}
            >
              {creatingToken ? "Creating..." : "Create token"}
            </button>
          </form>

          {createdTokenSecret && (
            <div
              className="cei-card-subtle"
              style={{
                border: "1px dashed rgba(34, 197, 94, 0.5)",
                padding: "0.6rem 0.75rem",
                borderRadius: "0.5rem",
                marginBottom: "0.75rem",
                background: "rgba(15, 23, 42, 0.7)",
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  marginBottom: "0.4rem",
                }}
              >
                New integration token (shown only once)
              </div>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  wordBreak: "break-all",
                  marginBottom: "0.4rem",
                }}
              >
                {createdTokenSecret}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "0.4rem",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Store this token securely (vault, password manager). You won’t
                  be able to see it again.
                </span>
                <button
                  type="button"
                  className="cei-btn"
                  onClick={handleCopySecret}
                  style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: "0.25rem",
              borderTop: "1px solid rgba(31, 41, 55, 0.9)",
              paddingTop: "0.6rem",
            }}
          >
            {tokensLoading ? (
              <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                Loading integration tokens...
              </div>
            ) : tokens.length === 0 ? (
              <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                No integration tokens yet. Create one above to let external
                systems push data into CEI.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                  fontSize: "0.8rem",
                }}
              >
                {tokens.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                      padding: "0.4rem 0.3rem",
                      borderRadius: "0.375rem",
                      backgroundColor: "rgba(15, 23, 42, 0.7)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.15rem",
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{t.name}</span>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--cei-text-muted)",
                        }}
                      >
                        Created: {t.created_at}
                        {t.last_used_at
                          ? ` • Last used: ${t.last_used_at}`
                          : ""}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span
                        className={
                          t.is_active
                            ? "cei-pill-success"
                            : "cei-pill-muted"
                        }
                        style={{ fontSize: "0.7rem" }}
                      >
                        {t.is_active ? "Active" : "Revoked"}
                      </span>
                      <button
                        type="button"
                        className="cei-btn"
                        disabled={!t.is_active || revokingId === t.id}
                        onClick={() => handleRevokeToken(t.id)}
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.25rem 0.6rem",
                          opacity:
                            !t.is_active || revokingId === t.id ? 0.6 : 1,
                        }}
                      >
                        {revokingId === t.id ? "Revoking..." : "Revoke"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Settings;
