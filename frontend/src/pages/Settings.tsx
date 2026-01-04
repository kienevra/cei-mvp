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
  if (s.trim() === "") return true; // allow empty (treated as null)
  const n = Number(s);
  return Number.isFinite(n) && n >= 0;
}

// --------- helpers to keep logic consistent & non-regressing ----------
function getOrgFromAccount(acc: any): OrganizationSummary | null {
  if (!acc) return null;
  return (acc.org as OrganizationSummary) ?? (acc.organization as OrganizationSummary) ?? null;
}

function getRoleFromAccount(acc: any): string {
  return String(acc?.role || "").toLowerCase();
}

function canManageSensitiveSettings(roleRaw: string): boolean {
  // keep legacy "admin" support (even if backend is owner/member)
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

const Settings: React.FC = () => {
  const { t } = useTranslation();

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
  const [copiedTokenSecret, setCopiedTokenSecret] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  // Derived account/org/role gating (stable + memoized)
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

  // Pricing configured heuristic (UI-side, until backend exposes pricing_configured)
  const currencyReady = normalizeCurrencyCode(currencyCodeInput).length === 3;
  const elecReady = electricityPriceInput.trim() !== "" && Number(electricityPriceInput) > 0;
  const gasReady = gasPriceInput.trim() !== "" && Number(gasPriceInput) > 0;
  const pricingConfigured = currencyReady && (elecReady || gasReady);

  const hasTariffConfig =
    primaryEnergySources.trim().length > 0 ||
    electricityPriceInput.trim().length > 0 ||
    gasPriceInput.trim().length > 0 ||
    currencyCodeInput.trim().length > 0;

  // Keep initial behavior: load on mount.
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
      console.error("Failed to load integration tokens", err);
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

      // Now that we know role, load tokens only for owner/admin.
      const role = getRoleFromAccount(anyData);
      const canManage = canManageSensitiveSettings(role);
      if (canManage) {
        await loadIntegrationTokens();
      } else {
        setTokens([]);
      }
    } catch (err: any) {
      console.error("Failed to load account for settings", err);
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
      console.error("Failed to create integration token", err);
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
      console.error("Failed to revoke integration token", err);
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
    } catch (e) {
      console.warn("Clipboard copy failed", e);
    }
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

    // basic validation before hitting backend
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
      gas_price_per_kwh: gasPriceInput.trim() === "" ? null : Number(gasPriceInput.trim()),
      currency_code: currencyCodeInput.trim() === "" ? null : cc,
    };

    try {
      const updated = await updateOrgSettings(payload);
      setAccount(updated);

      const updatedAny: any = updated || {};
      const updatedOrg = getOrgFromAccount(updatedAny);

      applyOrgToFormState(updatedOrg, updatedAny);

      setOrgSettingsSaved(true);
    } catch (err: any) {
      console.error("Failed to save org settings", err);
      setOrgSettingsError(toUiMessage(err, t("errors.generic")));
    } finally {
      setSavingOrgSettings(false);
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
          {t("settings.header.title")}
        </h1>
        <p
          style={{
            marginTop: "0.3rem",
            fontSize: "0.85rem",
            color: "var(--cei-text-muted)",
          }}
        >
          {t("settings.header.subtitle")}
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
            {t("settings.notifications.title")}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={emailAlerts}
              onChange={(e) => setEmailAlerts(e.target.checked)}
              style={{ width: "auto" }}
            />
            <span style={{ fontSize: "0.85rem" }}>
              {t("settings.notifications.emailAlertsLabel")}
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
            {t("settings.units.title")}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            {t("settings.units.subtitle")}
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
                background: unitSystem === "metric" ? "rgba(22, 163, 74, 0.25)" : "transparent",
              }}
              onClick={() => setUnitSystem("metric")}
            >
              {t("settings.units.metric")}
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
                  unitSystem === "imperial" ? "rgba(22, 163, 74, 0.25)" : "transparent",
              }}
              onClick={() => setUnitSystem("imperial")}
            >
              {t("settings.units.imperial")}
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
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>{t("settings.energyTariffs.title")}</span>

              {!canManageOrgSensitiveSettings && account && org && (
                <span className="cei-pill-muted" style={{ fontSize: "0.75rem" }}>
                  {t("settings.energyTariffs.ownerOnly")}
                </span>
              )}

              {account && org && !pricingConfigured && (
                <span className="cei-pill-muted" style={{ fontSize: "0.75rem" }}>
                  {t("settings.energyTariffs.noTariffsConfigured")}
                </span>
              )}
            </span>

            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
              {t("settings.energyTariffs.help")}
            </span>
          </div>

          {!canManageOrgSensitiveSettings && account && org && (
            <div
              className="cei-pill-muted"
              style={{ marginBottom: "0.6rem", fontSize: "0.8rem" }}
            >
              {t("settings.energyTariffs.readOnlyNotice")}
            </div>
          )}

          {accountLoading ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("settings.energyTariffs.loading")}
            </div>
          ) : accountError ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {accountError}
            </div>
          ) : !account ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("settings.energyTariffs.accountNotReady")}
            </div>
          ) : !org ? (
            <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
              {t("settings.energyTariffs.noOrg")}
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
                  {t("settings.energyTariffs.fields.primaryEnergySources.label")}
                </label>
                <input
                  type="text"
                  placeholder={t("settings.energyTariffs.fields.primaryEnergySources.placeholder")}
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
                  {t("settings.energyTariffs.fields.primaryEnergySources.help")}
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
                  {t("settings.energyTariffs.fields.electricityPrice.label")}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder={t("settings.energyTariffs.fields.electricityPrice.placeholder")}
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
                  {t("settings.energyTariffs.fields.gasPrice.label")}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder={t("settings.energyTariffs.fields.gasPrice.placeholder")}
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
                  {t("settings.energyTariffs.fields.currencyCode.label")}
                </label>
                <input
                  type="text"
                  maxLength={3}
                  placeholder={t("settings.energyTariffs.fields.currencyCode.placeholder")}
                  value={currencyCodeInput}
                  onChange={(e) => setCurrencyCodeInput(normalizeCurrencyCode(e.target.value))}
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
                  flexWrap: "wrap",
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
                      {t("settings.energyTariffs.messages.saved")}
                    </div>
                  )}

                  {!hasTariffConfig && !orgSettingsError && !orgSettingsSaved && (
                    <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                      {t("settings.energyTariffs.messages.fallbackKwhOnly")}
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
                      ? t("settings.energyTariffs.validation.ownerOnlyEdit")
                      : undefined
                  }
                >
                  {savingOrgSettings
                    ? t("settings.energyTariffs.actions.saving")
                    : t("settings.energyTariffs.actions.saveEnergySettings")}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* Integration tokens: show card for everyone (no 403 UX), but only owners can view/manage. */}
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

            <p
              style={{
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
                marginBottom: "0.75rem",
              }}
            >
              {t("settings.integrationTokens.description")}{" "}
              <code style={{ fontSize: "0.75rem" }}>
                {t("settings.integrationTokens.endpoint")}
              </code>
              .
            </p>

            {!canManageOrgSensitiveSettings ? (
              <div className="cei-pill-muted" style={{ fontSize: "0.8rem" }}>
                {t("settings.integrationTokens.noPermission")}
              </div>
            ) : (
              <>
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
                    placeholder={t("settings.integrationTokens.createPlaceholder")}
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
                        ? t("settings.integrationTokens.errors.ownerOnlyCreate")
                        : undefined
                    }
                  >
                    {creatingToken
                      ? t("settings.integrationTokens.creatingButton")
                      : t("settings.integrationTokens.createButton")}
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
                      {t("settings.integrationTokens.newTokenTitle")}
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
                        {t("settings.integrationTokens.newTokenHelp")}
                      </span>
                      <button
                        type="button"
                        className="cei-btn"
                        onClick={handleCopySecret}
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                        title={t("settings.integrationTokens.actions.copy")}
                      >
                        {copiedTokenSecret
                          ? t("settings.integrationTokens.actions.copied")
                          : t("settings.integrationTokens.actions.copy")}
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
                      {t("settings.integrationTokens.loading")}
                    </div>
                  ) : tokens.length === 0 ? (
                    <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                      {t("settings.integrationTokens.empty")}
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
                            backgroundColor: "rgba(15, 23, 42, 0.7)",
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontWeight: 500 }}>{tkn.name}</span>
                            <span style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                              {t("settings.integrationTokens.labels.created")}:{" "}
                              {fmtIsoOrRaw(tkn.created_at)}
                              {tkn.last_used_at
                                ? ` • ${t("settings.integrationTokens.labels.lastUsed")}: ${fmtIsoOrRaw(
                                    tkn.last_used_at
                                  )}`
                                : ""}
                            </span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                            <span
                              className={tkn.is_active ? "cei-pill-success" : "cei-pill-muted"}
                              style={{ fontSize: "0.7rem" }}
                            >
                              {tkn.is_active
                                ? t("settings.integrationTokens.status.active")
                                : t("settings.integrationTokens.status.revoked")}
                            </span>
                            <button
                              type="button"
                              className="cei-btn"
                              disabled={!tkn.is_active || revokingId === tkn.id}
                              onClick={() => handleRevokeToken(tkn.id)}
                              style={{
                                fontSize: "0.75rem",
                                padding: "0.25rem 0.6rem",
                                opacity: !tkn.is_active || revokingId === tkn.id ? 0.6 : 1,
                              }}
                              title={t("settings.integrationTokens.actions.revoke")}
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
