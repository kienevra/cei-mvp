// frontend/src/pages/Settings.tsx

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { usePushNotifications } from "../hooks/usePushNotifications";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  const data = err?.response?.data;
  if (data?.detail != null) {
    return typeof data.detail === "string"
      ? data.detail
      : safeStringify(data.detail) || fallback;
  }
  if (data?.message != null) {
    return typeof data.message === "string"
      ? data.message
      : safeStringify(data.message) || fallback;
  }
  if (err?.message) return String(err.message);
  return fallback;
}

function fmtIsoOrRaw(val: string | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleString();
}

function normalizeCurrencyCode(code: string): string {
  return (code || "").trim().toUpperCase().slice(0, 3);
}

function isValidNonNegNumberString(s: string): boolean {
  if (s.trim() === "") return true;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0;
}

function getOrgFromAccount(acc: any): OrganizationSummary | null {
  if (!acc) return null;
  return (acc.org as OrganizationSummary) ?? (acc.organization as OrganizationSummary) ?? null;
}

function getRoleFromAccount(acc: any): string {
  return String(acc?.role || "").toLowerCase();
}

function canManageSensitiveSettings(roleRaw: string): boolean {
  return roleRaw === "owner" || roleRaw === "admin";
}

function parsePrimaryEnergySources(org: any, accAny: any): string {
  const p = org?.primary_energy_sources;
  if (Array.isArray(p)) return p.join(", ");
  if (typeof p === "string") return p;
  if (Array.isArray(accAny?.primary_energy_sources)) return accAny.primary_energy_sources.join(", ");
  if (typeof accAny?.primary_energy_sources === "string") return accAny.primary_energy_sources;
  return "";
}

function parseNumberToInput(val: unknown): string {
  return typeof val === "number" ? String(val) : "";
}

function parseStringToInput(val: unknown): string {
  return typeof val === "string" ? val : "";
}

// ─── Component ────────────────────────────────────────────────────────────────
function PushNotificationCard() {
  const { permission, isSubscribed, isLoading, error, isSupported, enable, disable } =
    usePushNotifications();

  const statusColor = isSubscribed ? "#22c55e" : permission === "denied" ? "#f87171" : "#9ca3af";
  const statusText  = !isSupported
    ? "Not supported in this browser"
    : permission === "denied"
    ? "Blocked — enable in browser settings"
    : isSubscribed
    ? "Active on this device"
    : "Not enabled on this device";

  return (
    <>
      <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem",
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>Alert push notifications</span>
          <span style={{
            fontSize: "0.72rem", padding: "0.2rem 0.6rem", borderRadius: 999, fontWeight: 700,
            background: isSubscribed ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.08)",
            border: `1px solid ${isSubscribed ? "rgba(34,197,94,0.3)" : "rgba(148,163,184,0.15)"}`,
            color: statusColor,
          }}>
            {isSubscribed ? "● Enabled" : "○ Disabled"}
          </span>
        </span>
      </div>

      <p style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "0.75rem" }}>
        Receive banner notifications on this device when CEI fires a
        <strong style={{ color: "#fb923c" }}> warning</strong> or
        <strong style={{ color: "#f87171" }}> critical</strong> alert —
        even when the browser tab is closed.
      </p>

      <div style={{ fontSize: "0.78rem", color: "#9ca3af", marginBottom: "0.75rem" }}>
        Status: <span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span>
      </div>

      {error && (
        <div style={{ marginBottom: "0.6rem", fontSize: "0.78rem", color: "#f87171" }}>⚠ {error}</div>
      )}

      {isSupported && permission !== "denied" && (
        <button
          type="button"
          className="cei-btn"
          onClick={isSubscribed ? disable : enable}
          disabled={isLoading}
          style={{ opacity: isLoading ? 0.7 : 1 }}
        >
          {isLoading
            ? "Please wait…"
            : isSubscribed
            ? "Disable notifications on this device"
            : "Enable notifications on this device"}
        </button>
      )}

      {permission === "denied" && (
        <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.5rem" }}>
          Notifications are blocked at the browser level. Go to your browser's site
          settings for <strong>{window.location.hostname}</strong> and allow
          notifications, then reload the page.
        </p>
      )}
    </>
  );
}
const Settings: React.FC = () => {
  const { t } = useTranslation();

  const [emailAlerts, setEmailAlerts] = useState(true);
  const [savingEmailAlerts, setSavingEmailAlerts] = useState(false);
  const [unitSystem, setUnitSystem] = useState<"metric" | "imperial">(() => {
    try {
      const saved = localStorage.getItem("cei_unit_system");
      return saved === "imperial" ? "imperial" : "metric";
    } catch {
      return "metric";
    }
  });

  const [account, setAccount] = useState<AccountMe | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const [savingOrgSettings, setSavingOrgSettings] = useState(false);
  const [orgSettingsError, setOrgSettingsError] = useState<string | null>(null);
  const [orgSettingsSaved, setOrgSettingsSaved] = useState(false);

  const [primaryEnergySources, setPrimaryEnergySources] = useState("");
  const [electricityPriceInput, setElectricityPriceInput] = useState("");
  const [gasPriceInput, setGasPriceInput] = useState("");
  const [currencyCodeInput, setCurrencyCodeInput] = useState("");

  // Country hint — frontend-only, persisted to localStorage
  const [countryHintKey, setCountryHintKey] = useState<string>(
    () => {
      try { return localStorage.getItem("cei_country_hint") || ""; } catch { return ""; }
    }
  );
  const [hintApplied, setHintApplied] = useState(false);

  const [tokens, setTokens] = useState<IntegrationToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);

  const [newTokenName, setNewTokenName] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [createdTokenSecret, setCreatedTokenSecret] = useState<string | null>(null);
  const [copiedTokenSecret, setCopiedTokenSecret] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const accountAny: any = account || {};
  const org: OrganizationSummary | null = useMemo(() => getOrgFromAccount(accountAny), [accountAny]);
  const roleRaw = useMemo(() => getRoleFromAccount(accountAny), [accountAny]);
  const canManageOrgSensitiveSettings = useMemo(
    () => canManageSensitiveSettings(roleRaw),
    [roleRaw]
  );

  const disabledFieldStyle: React.CSSProperties = {
    opacity: 0.75,
    cursor: "not-allowed",
  };

  const currencyReady = normalizeCurrencyCode(currencyCodeInput).length === 3;
  const elecReady = electricityPriceInput.trim() !== "" && Number(electricityPriceInput) > 0;
  const gasReady = gasPriceInput.trim() !== "" && Number(gasPriceInput) > 0;
  const pricingConfigured = currencyReady && (elecReady || gasReady);

  const hasTariffConfig =
    primaryEnergySources.trim().length > 0 ||
    electricityPriceInput.trim().length > 0 ||
    gasPriceInput.trim().length > 0 ||
    currencyCodeInput.trim().length > 0;

  const activeHint = countryHintKey ? COUNTRY_TARIFF_HINTS[countryHintKey] : null;

  // ── Country hint handler ──────────────────────────────────────────────────
  const handleCountryHintChange = (code: string) => {
    setCountryHintKey(code);
    setHintApplied(false);
    try { localStorage.setItem("cei_country_hint", code); } catch {}

    if (!code) return;
    const hint = COUNTRY_TARIFF_HINTS[code];
    if (!hint) return;

    // Pre-fill all tariff fields with estimated values
    setElectricityPriceInput(hint.electricity);
    if (hint.gas !== "0.0000") setGasPriceInput(hint.gas);
    setCurrencyCodeInput(hint.currency);
    setHintApplied(true);
    setOrgSettingsSaved(false);

    // Clear the "applied" badge after 4 seconds
    setTimeout(() => setHintApplied(false), 4000);
  };

  useEffect(() => {
    loadAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyOrgToFormState = (orgFromData: OrganizationSummary | null, anyData: any) => {
    if (!orgFromData) {
      setPrimaryEnergySources("");
      setElectricityPriceInput("");
      setGasPriceInput("");
      setCurrencyCodeInput("");
      return;
    }
     setEmailAlerts(
      typeof (orgFromData as any).enable_notification_emails === "boolean"
        ? (orgFromData as any).enable_notification_emails
        : true
    );
    setPrimaryEnergySources(parsePrimaryEnergySources(orgFromData as any, anyData));
    setElectricityPriceInput(
      parseNumberToInput((orgFromData as any)?.electricity_price_per_kwh) ||
        parseNumberToInput(anyData?.electricity_price_per_kwh)
    );
    setGasPriceInput(
      parseNumberToInput((orgFromData as any)?.gas_price_per_kwh) ||
        parseNumberToInput(anyData?.gas_price_per_kwh)
    );
    setCurrencyCodeInput(
      parseStringToInput((orgFromData as any)?.currency_code) ||
        parseStringToInput(anyData?.currency_code)
    );
  };

  const loadIntegrationTokens = async () => {
    setTokensLoading(true);
    setTokensError(null);
    try {
      const list = await listIntegrationTokens();
      setTokens(Array.isArray(list) ? (list as any) : []);
    } catch (err: any) {
      setTokensError(toUiMessage(err, t("settings.integrationTokens.errors.load")));
    } finally {
      setTokensLoading(false);
    }
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
      const orgFromData = getOrgFromAccount(anyData);
      applyOrgToFormState(orgFromData, anyData);
      const role = getRoleFromAccount(anyData);
      if (canManageSensitiveSettings(role)) {
        await loadIntegrationTokens();
      } else {
        setTokens([]);
      }
    } catch (err: any) {
      setAccountError(toUiMessage(err, t("settings.energyTariffs.accountErrorFallback")));
    } finally {
      setAccountLoading(false);
    }
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName.trim()) return;
    if (!canManageOrgSensitiveSettings) {
      setTokensError(t("settings.integrationTokens.errors.ownerOnlyCreate"));
      return;
    }
    setCreatingToken(true);
    setTokensError(null);
    setCreatedTokenSecret(null);
    setCopiedTokenSecret(false);
    try {
      const created = await createIntegrationToken(newTokenName.trim());
      setCreatedTokenSecret(created?.token || null);
      setNewTokenName("");
      await loadIntegrationTokens();
    } catch (err: any) {
      setTokensError(toUiMessage(err, t("settings.integrationTokens.errors.create")));
    } finally {
      setCreatingToken(false);
    }
  };

  const handleRevokeToken = async (id: number) => {
    if (!canManageOrgSensitiveSettings) {
      setTokensError(t("settings.integrationTokens.errors.ownerOnlyRevoke"));
      return;
    }
    setRevokingId(id);
    setTokensError(null);
    try {
      await revokeIntegrationToken(id);
      await loadIntegrationTokens();
    } catch (err: any) {
      setTokensError(toUiMessage(err, t("settings.integrationTokens.errors.revoke")));
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopySecret = async () => {
    if (!createdTokenSecret) return;
    try {
      await navigator.clipboard.writeText(createdTokenSecret);
      setCopiedTokenSecret(true);
      window.setTimeout(() => setCopiedTokenSecret(false), 1500);
    } catch {}
  };

  const handleOrgSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) {
      setOrgSettingsError(t("settings.energyTariffs.validation.accountNotLoaded"));
      return;
    }
    if (!canManageOrgSensitiveSettings) {
      setOrgSettingsError(t("settings.energyTariffs.validation.ownerOnlyEdit"));
      return;
    }
    const anyAcc: any = account;
    const orgFromAccount = getOrgFromAccount(anyAcc);
    if (!orgFromAccount) {
      setOrgSettingsError(t("settings.energyTariffs.validation.noOrg"));
      return;
    }
    const cc = normalizeCurrencyCode(currencyCodeInput);
    if (currencyCodeInput.trim() !== "" && cc.length !== 3) {
      setOrgSettingsError(t("settings.energyTariffs.validation.currencyCodeInvalid"));
      return;
    }
    if (!isValidNonNegNumberString(electricityPriceInput)) {
      setOrgSettingsError(t("settings.energyTariffs.validation.electricityNonNegative"));
      return;
    }
    if (!isValidNonNegNumberString(gasPriceInput)) {
      setOrgSettingsError(t("settings.energyTariffs.validation.gasNonNegative"));
      return;
    }

    setOrgSettingsError(null);
    setOrgSettingsSaved(false);
    setSavingOrgSettings(true);

    const payload: OrgSettingsUpdateRequest = {
      primary_energy_sources:
        primaryEnergySources.trim() === "" ? null : primaryEnergySources.trim(),
      electricity_price_per_kwh:
        electricityPriceInput.trim() === "" ? null : Number(electricityPriceInput.trim()),
      gas_price_per_kwh:
        gasPriceInput.trim() === "" ? null : Number(gasPriceInput.trim()),
      currency_code:
        currencyCodeInput.trim() === "" ? null : cc,
    };

    try {
      const updated = await updateOrgSettings(payload);
      setAccount(updated);
      const updatedAny: any = updated || {};
      const updatedOrg = getOrgFromAccount(updatedAny);
      applyOrgToFormState(updatedOrg, updatedAny);
      setOrgSettingsSaved(true);
    } catch (err: any) {
      setOrgSettingsError(toUiMessage(err, t("errors.generic")));
    } finally {
      setSavingOrgSettings(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="dashboard-page">
      <section>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
          {t("settings.header.title")}
        </h1>
        <p style={{ marginTop: "0.3rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
          {t("settings.header.subtitle")}
        </p>
      </section>

      <section className="dashboard-row">
        <div className="cei-card">
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {t("settings.notifications.title")}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={emailAlerts}
              disabled={savingEmailAlerts}
              onChange={async (e) => {
                const newVal = e.target.checked;
                setEmailAlerts(newVal);
                setSavingEmailAlerts(true);
                try {
                  await updateOrgSettings({
                    enable_notification_emails: newVal,
                  } as any);
                } catch {
                  // revert on failure
                  setEmailAlerts(!newVal);
                } finally {
                  setSavingEmailAlerts(false);
                }
              }}
              style={{ width: "auto", opacity: savingEmailAlerts ? 0.6 : 1 }}
            />
            <span style={{ fontSize: "0.85rem" }}>
              {t("settings.notifications.emailAlertsLabel")}
            </span>
          </label>
        </div>

        <div className="cei-card">
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {t("settings.units.title")}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            {t("settings.units.subtitle")}
          </div>
          <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="cei-btn"
              style={{
                borderColor: unitSystem === "metric" ? "rgba(34,197,94,0.5)" : "rgba(156,163,175,0.4)",
                background: unitSystem === "metric" ? "rgba(22,163,74,0.25)" : "transparent",
              }}
              onClick={() => {
                setUnitSystem("metric");
                try { localStorage.setItem("cei_unit_system", "metric"); } catch {}
              }}
            >
              {t("settings.units.metric")}
            </button>
            <button
              type="button"
              className="cei-btn"
              style={{
                borderColor: unitSystem === "imperial" ? "rgba(34,197,94,0.5)" : "rgba(156,163,175,0.4)",
                background: unitSystem === "imperial" ? "rgba(22,163,74,0.25)" : "transparent",
              }}
              onClick={() => {
                setUnitSystem("imperial");
                try { localStorage.setItem("cei_unit_system", "imperial"); } catch {}
              }}
            >
              {t("settings.units.imperial")}
            </button>
          </div>
        </div>
      </section>

      {/* ── Push notifications ── */}
      {account && org && (
        <section className="dashboard-row">
          <div className="cei-card" style={{ width: "100%" }}>
            <PushNotificationCard />
          </div>
        </section>
      )}

      {/* ── Integration tokens ── */}
      {account && org && (
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
                flexWrap: "wrap",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span>{t("settings.integrationTokens.title")}</span>
                <span className="cei-pill-muted" style={{ fontSize: "0.75rem" }}>
                  {t("settings.integrationTokens.ownerOnly")}
                </span>
              </span>
            </div>

            <p style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", marginBottom: "0.75rem" }}>
              {t("settings.integrationTokens.description")}{" "}
              <code style={{ fontSize: "0.75rem" }}>
                {t("settings.integrationTokens.endpoint")}
              </code>.
            </p>

            {!canManageOrgSensitiveSettings ? (
              <div className="cei-pill-muted" style={{ fontSize: "0.8rem" }}>
                {t("settings.integrationTokens.noPermission")}
              </div>
            ) : (
              <>
                {tokensError && (
                  <div className="cei-pill-danger" style={{ marginBottom: "0.6rem", fontSize: "0.8rem" }}>
                    {tokensError}
                  </div>
                )}

                <form
                  onSubmit={handleCreateToken}
                  style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem", alignItems: "center" }}
                >
                  <input
                    type="text"
                    placeholder={t("settings.integrationTokens.createPlaceholder")}
                    value={newTokenName}
                    onChange={(e) => setNewTokenName(e.target.value)}
                    disabled={!canManageOrgSensitiveSettings}
                    style={{
                      flex: "1 1 200px",
                      minWidth: "0",
                      padding: "0.4rem 0.6rem",
                      borderRadius: "0.375rem",
                      border: "1px solid rgba(156,163,175,0.4)",
                      backgroundColor: "rgba(15,23,42,0.8)",
                      color: "var(--cei-text)",
                      fontSize: "0.85rem",
                      ...(canManageOrgSensitiveSettings ? {} : disabledFieldStyle),
                    }}
                  />
                  <button
                    type="submit"
                    className="cei-btn"
                    disabled={!canManageOrgSensitiveSettings || creatingToken}
                    style={{ whiteSpace: "nowrap", opacity: !canManageOrgSensitiveSettings || creatingToken ? 0.7 : 1 }}
                    title={!canManageOrgSensitiveSettings ? t("settings.integrationTokens.errors.ownerOnlyCreate") : undefined}
                  >
                    {creatingToken
                      ? t("settings.integrationTokens.creatingButton")
                      : t("settings.integrationTokens.createButton")}
                  </button>
                </form>

                {createdTokenSecret && (
                  <div
                    style={{
                      border: "1px dashed rgba(34,197,94,0.5)",
                      padding: "0.6rem 0.75rem",
                      borderRadius: "0.5rem",
                      marginBottom: "0.75rem",
                      background: "rgba(15,23,42,0.7)",
                    }}
                  >
                    <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.4rem" }}>
                      {t("settings.integrationTokens.newTokenTitle")}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.8rem", wordBreak: "break-all", marginBottom: "0.4rem" }}>
                      {createdTokenSecret}
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                        {t("settings.integrationTokens.newTokenHelp")}
                      </span>
                      <button
                        type="button"
                        className="cei-btn"
                        onClick={handleCopySecret}
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                      >
                        {copiedTokenSecret
                          ? t("settings.integrationTokens.actions.copied")
                          : t("settings.integrationTokens.actions.copy")}
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: "0.25rem", borderTop: "1px solid rgba(31,41,55,0.9)", paddingTop: "0.6rem" }}>
                  {tokensLoading ? (
                    <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                      {t("settings.integrationTokens.loading")}
                    </div>
                  ) : tokens.length === 0 ? (
                    <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                      {t("settings.integrationTokens.empty")}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.8rem" }}>
                      {tokens.map((tkn) => (
                        <div
                          key={tkn.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "0.75rem",
                            padding: "0.4rem 0.3rem",
                            borderRadius: "0.375rem",
                            backgroundColor: "rgba(15,23,42,0.7)",
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontWeight: 500 }}>{tkn.name}</span>
                            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                              {t("settings.integrationTokens.labels.created")}: {fmtIsoOrRaw(tkn.created_at)}
                              {tkn.last_used_at
                                ? ` • ${t("settings.integrationTokens.labels.lastUsed")}: ${fmtIsoOrRaw(tkn.last_used_at)}`
                                : ""}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                            <span className={tkn.is_active ? "cei-pill-success" : "cei-pill-muted"} style={{ fontSize: "0.7rem" }}>
                              {tkn.is_active
                                ? t("settings.integrationTokens.status.active")
                                : t("settings.integrationTokens.status.revoked")}
                            </span>
                            <button
                              type="button"
                              className="cei-btn"
                              disabled={!tkn.is_active || revokingId === tkn.id}
                              onClick={() => handleRevokeToken(tkn.id)}
                              style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem", opacity: !tkn.is_active || revokingId === tkn.id ? 0.6 : 1 }}
                            >
                              {revokingId === tkn.id
                                ? t("settings.integrationTokens.actions.revoking")
                                : t("settings.integrationTokens.actions.revoke")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default Settings;
