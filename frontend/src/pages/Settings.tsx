// frontend/src/pages/Settings.tsx
import React, { useState, useEffect } from "react";
import {
  getAccountMe,
  updateOrgSettings,
  listIntegrationTokens,
  createIntegrationToken,
  revokeIntegrationToken,
} from "../services/api";
import type {
  AccountMe,
  OrganizationSummary,
  OrgSettingsUpdateRequest,
} from "../types/auth";

type IntegrationToken = {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
};

function safeStringify(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function toUiMessage(err: any, fallback: string): string {
  // Handles FastAPI {detail: ...}, {message: ...}, or weird objects like {code, message}
  const data = err?.response?.data;
  if (data?.detail != null) {
    return typeof data.detail === "string" ? data.detail : safeStringify(data.detail) || fallback;
  }
  if (data?.message != null) {
    return typeof data.message === "string" ? data.message : safeStringify(data.message) || fallback;
  }
  if (err?.message) return String(err.message);
  return fallback;
}

const Settings: React.FC = () => {
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [unitSystem, setUnitSystem] = useState<"metric" | "imperial">("metric");

  // Account / org (for tariffs & energy mix)
  const [account, setAccount] = useState<AccountMe | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Org energy/tariff form state
  const [savingOrgSettings, setSavingOrgSettings] = useState(false);
  const [orgSettingsError, setOrgSettingsError] = useState<string | null>(null);
  const [orgSettingsSaved, setOrgSettingsSaved] = useState(false);

  const [primaryEnergySources, setPrimaryEnergySources] = useState("");
  const [electricityPriceInput, setElectricityPriceInput] = useState("");
  const [gasPriceInput, setGasPriceInput] = useState("");
  const [currencyCodeInput, setCurrencyCodeInput] = useState("");

  // Integration tokens state
  const [tokens, setTokens] = useState<IntegrationToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);

  const [newTokenName, setNewTokenName] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [createdTokenSecret, setCreatedTokenSecret] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  useEffect(() => {
    loadAccount();
    loadIntegrationTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flexible org/account view for gating (declared early so handlers can use it)
  const accountAny: any = account || {};
  const org: OrganizationSummary | null =
    (accountAny.org as OrganizationSummary) ??
    (accountAny.organization as OrganizationSummary) ??
    null;

  const roleRaw = String(accountAny.role || "").toLowerCase();
  const isOwner = roleRaw === "owner";
  const isAdmin = roleRaw === "admin";
  const canManageOrgSensitiveSettings = isOwner || isAdmin;

  const disabledFieldStyle: React.CSSProperties = {
    opacity: 0.75,
    cursor: "not-allowed",
  };

  const loadAccount = async () => {
    setAccountLoading(true);
    setAccountError(null);
    setOrgSettingsError(null);
    setOrgSettingsSaved(false);
    try {
      const data = await getAccountMe();
      setAccount(data);

      const anyData: any = data || {};
      const orgFromData: OrganizationSummary | null =
        (anyData.org as OrganizationSummary) ??
        (anyData.organization as OrganizationSummary) ??
        null;

      if (orgFromData) {
        // primary_energy_sources might be string or string[]
        const p = (orgFromData as any).primary_energy_sources;
        if (Array.isArray(p)) {
          setPrimaryEnergySources(p.join(", "));
        } else if (typeof p === "string") {
          setPrimaryEnergySources(p);
        } else if (Array.isArray(anyData.primary_energy_sources)) {
          setPrimaryEnergySources(anyData.primary_energy_sources.join(", "));
        } else if (typeof anyData.primary_energy_sources === "string") {
          setPrimaryEnergySources(anyData.primary_energy_sources);
        } else {
          setPrimaryEnergySources("");
        }

        // Electricity price
        if (typeof (orgFromData as any).electricity_price_per_kwh === "number") {
          setElectricityPriceInput(String((orgFromData as any).electricity_price_per_kwh));
        } else if (typeof anyData.electricity_price_per_kwh === "number") {
          setElectricityPriceInput(String(anyData.electricity_price_per_kwh));
        } else {
          setElectricityPriceInput("");
        }

        // Gas price
        if (typeof (orgFromData as any).gas_price_per_kwh === "number") {
          setGasPriceInput(String((orgFromData as any).gas_price_per_kwh));
        } else if (typeof anyData.gas_price_per_kwh === "number") {
          setGasPriceInput(String(anyData.gas_price_per_kwh));
        } else {
          setGasPriceInput("");
        }

        // Currency code
        if (typeof (orgFromData as any).currency_code === "string") {
          setCurrencyCodeInput((orgFromData as any).currency_code);
        } else if (typeof anyData.currency_code === "string") {
          setCurrencyCodeInput(anyData.currency_code);
        } else {
          setCurrencyCodeInput("");
        }
      } else {
        // No org associated; keep fields blank
        setPrimaryEnergySources("");
        setElectricityPriceInput("");
        setGasPriceInput("");
        setCurrencyCodeInput("");
      }
    } catch (err: any) {
      console.error("Failed to load account for settings", err);
      setAccountError(toUiMessage(err, "Failed to load account details."));
    } finally {
      setAccountLoading(false);
    }
  };

  const loadIntegrationTokens = async () => {
    setTokensLoading(true);
    setTokensError(null);
    try {
      // NOTE: api helper returns [] for 403 (non-owner), so Settings doesn’t explode.
      const list = await listIntegrationTokens();
      setTokens(Array.isArray(list) ? (list as any) : []);
    } catch (err: any) {
      console.error("Failed to load integration tokens", err);
      setTokensError(toUiMessage(err, "Failed to load integration tokens."));
    } finally {
      setTokensLoading(false);
    }
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName.trim()) return;

    if (!canManageOrgSensitiveSettings) {
      setTokensError("Only the org owner can create integration tokens.");
      return;
    }

    setCreatingToken(true);
    setTokensError(null);
    setCreatedTokenSecret(null);
    try {
      const created = await createIntegrationToken(newTokenName.trim());
      // Backend returns the raw token only once in `token`
      setCreatedTokenSecret(created?.token || null);
      setNewTokenName("");
      await loadIntegrationTokens();
    } catch (err: any) {
      console.error("Failed to create integration token", err);
      setTokensError(toUiMessage(err, "Failed to create integration token."));
    } finally {
      setCreatingToken(false);
    }
  };

  const handleRevokeToken = async (id: number) => {
    if (!canManageOrgSensitiveSettings) {
      setTokensError("Only the org owner can revoke integration tokens.");
      return;
    }

    setRevokingId(id);
    setTokensError(null);
    try {
      await revokeIntegrationToken(id);
      await loadIntegrationTokens();
    } catch (err: any) {
      console.error("Failed to revoke integration token", err);
      setTokensError(toUiMessage(err, "Failed to revoke integration token."));
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopySecret = async () => {
    if (!createdTokenSecret) return;
    try {
      await navigator.clipboard.writeText(createdTokenSecret);
      // silent success
    } catch (e) {
      console.warn("Clipboard copy failed", e);
    }
  };

  const handleOrgSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!account) {
      setOrgSettingsError("Account details are not loaded yet.");
      return;
    }

    if (!canManageOrgSensitiveSettings) {
      setOrgSettingsError("Only the org owner can update tariff settings.");
      return;
    }

    const anyAcc: any = account;
    const orgFromAccount: OrganizationSummary | null =
      (anyAcc.org as OrganizationSummary) ??
      (anyAcc.organization as OrganizationSummary) ??
      null;

    if (!orgFromAccount) {
      setOrgSettingsError("No organization is associated with this account yet.");
      return;
    }

    setOrgSettingsError(null);
    setOrgSettingsSaved(false);
    setSavingOrgSettings(true);

    const payload: OrgSettingsUpdateRequest = {
      primary_energy_sources:
        primaryEnergySources.trim() === "" ? null : primaryEnergySources.trim(),
      electricity_price_per_kwh:
        electricityPriceInput.trim() === ""
          ? null
          : Number(electricityPriceInput.trim()),
      gas_price_per_kwh: gasPriceInput.trim() === "" ? null : Number(gasPriceInput.trim()),
      currency_code:
        currencyCodeInput.trim() === ""
          ? null
          : currencyCodeInput.trim().toUpperCase(),
    };

    try {
      const updated = await updateOrgSettings(payload);
      setAccount(updated);

      const updatedAny: any = updated || {};
      const updatedOrg: OrganizationSummary | null =
        (updatedAny.org as OrganizationSummary) ??
        (updatedAny.organization as OrganizationSummary) ??
        null;

      if (updatedOrg) {
        const p = (updatedOrg as any).primary_energy_sources;
        if (Array.isArray(p)) {
          setPrimaryEnergySources(p.join(", "));
        } else if (typeof p === "string") {
          setPrimaryEnergySources(p);
        } else if (Array.isArray(updatedAny.primary_energy_sources)) {
          setPrimaryEnergySources(updatedAny.primary_energy_sources.join(", "));
        } else if (typeof updatedAny.primary_energy_sources === "string") {
          setPrimaryEnergySources(updatedAny.primary_energy_sources);
        } else {
          setPrimaryEnergySources("");
        }

        if (typeof (updatedOrg as any).electricity_price_per_kwh === "number") {
          setElectricityPriceInput(String((updatedOrg as any).electricity_price_per_kwh));
        } else if (typeof updatedAny.electricity_price_per_kwh === "number") {
          setElectricityPriceInput(String(updatedAny.electricity_price_per_kwh));
        } else {
          setElectricityPriceInput("");
        }

        if (typeof (updatedOrg as any).gas_price_per_kwh === "number") {
          setGasPriceInput(String((updatedOrg as any).gas_price_per_kwh));
        } else if (typeof updatedAny.gas_price_per_kwh === "number") {
          setGasPriceInput(String(updatedAny.gas_price_per_kwh));
        } else {
          setGasPriceInput("");
        }

        if (typeof (updatedOrg as any).currency_code === "string") {
          setCurrencyCodeInput((updatedOrg as any).currency_code);
        } else if (typeof updatedAny.currency_code === "string") {
          setCurrencyCodeInput(updatedAny.currency_code);
        } else {
          setCurrencyCodeInput("");
        }
      }

      setOrgSettingsSaved(true);
    } catch (err: any) {
      console.error("Failed to save org settings", err);
      setOrgSettingsError(toUiMessage(err, "Failed to save organization settings."));
    } finally {
      setSavingOrgSettings(false);
    }
  };

  const hasTariffConfig =
    primaryEnergySources.trim().length > 0 ||
    electricityPriceInput.trim().length > 0 ||
    gasPriceInput.trim().length > 0 ||
    currencyCodeInput.trim().length > 0;

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
          Local preferences for your CEI experience, plus technical settings for
          data ingestion.
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

      {/* Energy & tariffs (editable; drives cost engine) */}
      <section className="dashboard-row">
        <div className="cei-card" style={{ width: "100%" }}>
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <span>Energy & tariffs</span>
            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
              Org-level settings used by the cost engine in KPIs, alerts, and reports.
            </span>
          </div>

          {!canManageOrgSensitiveSettings && account && org && (
            <div
              className="cei-pill-muted"
              style={{ marginBottom: "0.6rem", fontSize: "0.8rem" }}
            >
              Only the org owner can change tariffs and energy mix. You can view
              settings, but editing is disabled.
            </div>
          )}

          {accountLoading ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              Loading organization settings…
            </div>
          ) : accountError ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {accountError}
            </div>
          ) : !account ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              Account details are not available yet. Once your org is set up, you
              can configure energy costs here.
            </div>
          ) : !org ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              No organization is associated with this account yet. Cost analytics
              will remain disabled until an org is created.
            </div>
          ) : (
            <form
              onSubmit={handleOrgSettingsSubmit}
              style={{
                marginTop: "0.75rem",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "0.75rem",
                fontSize: "0.8rem",
              }}
            >
              <div style={{ gridColumn: "1 / -1" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    marginBottom: "0.2rem",
                  }}
                >
                  Primary energy sources
                </label>
                <input
                  type="text"
                  placeholder='e.g. "electricity", "electricity,gas"'
                  value={primaryEnergySources}
                  onChange={(e) => setPrimaryEnergySources(e.target.value)}
                  disabled={!canManageOrgSensitiveSettings}
                  style={{
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    borderRadius: "0.375rem",
                    border: "1px solid rgba(156, 163, 175, 0.4)",
                    backgroundColor: "rgba(15, 23, 42, 0.8)",
                    color: "var(--cei-text)",
                    ...(canManageOrgSensitiveSettings ? {} : disabledFieldStyle),
                  }}
                />
                <div
                  style={{
                    marginTop: "0.2rem",
                    fontSize: "0.75rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Comma-separated list; currently used for labeling and context.
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    marginBottom: "0.2rem",
                  }}
                >
                  Electricity price (per kWh)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="e.g. 0.18"
                  value={electricityPriceInput}
                  onChange={(e) => setElectricityPriceInput(e.target.value)}
                  disabled={!canManageOrgSensitiveSettings}
                  style={{
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    borderRadius: "0.375rem",
                    border: "1px solid rgba(156, 163, 175, 0.4)",
                    backgroundColor: "rgba(15, 23, 42, 0.8)",
                    color: "var(--cei-text)",
                    ...(canManageOrgSensitiveSettings ? {} : disabledFieldStyle),
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    marginBottom: "0.2rem",
                  }}
                >
                  Gas price (per kWh, optional)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="e.g. 0.06"
                  value={gasPriceInput}
                  onChange={(e) => setGasPriceInput(e.target.value)}
                  disabled={!canManageOrgSensitiveSettings}
                  style={{
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    borderRadius: "0.375rem",
                    border: "1px solid rgba(156, 163, 175, 0.4)",
                    backgroundColor: "rgba(15, 23, 42, 0.8)",
                    color: "var(--cei-text)",
                    ...(canManageOrgSensitiveSettings ? {} : disabledFieldStyle),
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    marginBottom: "0.2rem",
                  }}
                >
                  Currency code
                </label>
                <input
                  type="text"
                  maxLength={3}
                  placeholder="e.g. EUR"
                  value={currencyCodeInput}
                  onChange={(e) => setCurrencyCodeInput(e.target.value.toUpperCase())}
                  disabled={!canManageOrgSensitiveSettings}
                  style={{
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    borderRadius: "0.375rem",
                    border: "1px solid rgba(156, 163, 175, 0.4)",
                    backgroundColor: "rgba(15, 23, 42, 0.8)",
                    color: "var(--cei-text)",
                    ...(canManageOrgSensitiveSettings ? {} : disabledFieldStyle),
                  }}
                />
              </div>

              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "0.4rem",
                  gap: "0.5rem",
                }}
              >
                <div style={{ minHeight: "1.1rem" }}>
                  {orgSettingsError && (
                    <div style={{ fontSize: "0.75rem", color: "#f87171" }}>
                      {orgSettingsError}
                    </div>
                  )}
                  {orgSettingsSaved && !orgSettingsError && (
                    <div style={{ fontSize: "0.75rem", color: "#4ade80" }}>
                      Settings saved. Cost analytics will now use these values.
                    </div>
                  )}
                  {!hasTariffConfig && !orgSettingsError && !orgSettingsSaved && (
                    <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                      Until tariffs are configured, CEI will fall back to kWh-only analytics.
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  className="cei-btn"
                  disabled={!canManageOrgSensitiveSettings || savingOrgSettings}
                  style={{
                    whiteSpace: "nowrap",
                    opacity: !canManageOrgSensitiveSettings || savingOrgSettings ? 0.7 : 1,
                  }}
                  title={
                    !canManageOrgSensitiveSettings
                      ? "Only the org owner can update these settings."
                      : undefined
                  }
                >
                  {savingOrgSettings ? "Saving..." : "Save energy settings"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="dashboard-row">
        <div className="cei-card" style={{ width: "100%" }}>
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <span>Integration tokens</span>
            {!canManageOrgSensitiveSettings && account && org && (
              <span className="cei-pill-muted" style={{ fontSize: "0.75rem" }}>
                Owner-only
              </span>
            )}
          </div>

          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              marginBottom: "0.75rem",
            }}
          >
            Long-lived API tokens for SCADA/BMS/historian systems to push timeseries data
            directly into CEI via{" "}
            <code style={{ fontSize: "0.75rem" }}>POST /api/v1/timeseries/batch</code>.
          </p>

          {!canManageOrgSensitiveSettings && account && org && (
            <div
              className="cei-pill-muted"
              style={{ marginBottom: "0.6rem", fontSize: "0.8rem" }}
            >
              Only the org owner can create or revoke integration tokens. You can view
              tokens, but management is disabled.
            </div>
          )}

          {tokensError && (
            <div
              className="cei-pill-danger"
              style={{ marginBottom: "0.6rem", fontSize: "0.8rem" }}
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
              disabled={!canManageOrgSensitiveSettings}
              style={{
                flex: "1 1 200px",
                minWidth: "0",
                padding: "0.4rem 0.6rem",
                borderRadius: "0.375rem",
                border: "1px solid rgba(156, 163, 175, 0.4)",
                backgroundColor: "rgba(15, 23, 42, 0.8)",
                color: "var(--cei-text)",
                fontSize: "0.85rem",
                ...(canManageOrgSensitiveSettings ? {} : disabledFieldStyle),
              }}
            />
            <button
              type="submit"
              className="cei-btn"
              disabled={!canManageOrgSensitiveSettings || creatingToken}
              style={{
                whiteSpace: "nowrap",
                opacity: !canManageOrgSensitiveSettings || creatingToken ? 0.7 : 1,
              }}
              title={
                !canManageOrgSensitiveSettings
                  ? "Only the org owner can create tokens."
                  : undefined
              }
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
              <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.4rem" }}>
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
                <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                  Store this token securely (vault, password manager). You won’t be able to see it again.
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
                No integration tokens yet. Create one above to let external systems push data into CEI.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.8rem" }}>
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
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                      <span style={{ fontWeight: 500 }}>{t.name}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                        Created: {t.created_at}
                        {t.last_used_at ? ` • Last used: ${t.last_used_at}` : ""}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <span
                        className={t.is_active ? "cei-pill-success" : "cei-pill-muted"}
                        style={{ fontSize: "0.7rem" }}
                      >
                        {t.is_active ? "Active" : "Revoked"}
                      </span>
                      <button
                        type="button"
                        className="cei-btn"
                        disabled={
                          !canManageOrgSensitiveSettings ||
                          !t.is_active ||
                          revokingId === t.id
                        }
                        onClick={() => handleRevokeToken(t.id)}
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.25rem 0.6rem",
                          opacity:
                            !canManageOrgSensitiveSettings ||
                            !t.is_active ||
                            revokingId === t.id
                              ? 0.6
                              : 1,
                        }}
                        title={
                          !canManageOrgSensitiveSettings
                            ? "Only the org owner can revoke tokens."
                            : undefined
                        }
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
