// frontend/src/components/ComplianceReports.tsx
/**
 * Compliance Documents download panel.
 * Renders four document cards (MRV, ETS, EnPI, Correlation),
 * each with a date-picker modal and a PDF download button.
 *
 * Drop into Reports.tsx:
 *   import ComplianceReports from "../components/ComplianceReports";
 *   // at the bottom of the JSX, inside the outer <div className="dashboard-page">:
 *   <ComplianceReports sites={sites} userOrgId={user?.organization_id} />
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import api from "../services/api";
import LoadingSpinner from "./LoadingSpinner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SiteRecord = {
  id: number | string;
  name: string;
  location?: string | null;
};

type Props = {
  sites: SiteRecord[];
  userOrgId?: number | null;
};

type DocType = "mrv" | "ets" | "enpi" | "correlation";

// Per-document form state
interface MrvForm {
  siteId: string;
  periodStart: string;
  periodEnd: string;
  quarter: string; // "1"|"2"|"3"|"4"|""
}

interface EtsForm {
  year: string;
}

interface EnpiForm {
  siteId: string;
  baselineStart: string;
  baselineEnd: string;
  currentStart: string;
  currentEnd: string;
}

interface CorrelationForm {
  siteId: string;
  periodStart: string;
  periodEnd: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function currentYear(): string {
  return String(new Date().getFullYear());
}

function normaliseLang(lang: string): "en" | "it" {
  return (lang || "en").toLowerCase().startsWith("it") ? "it" : "en";
}

async function triggerPdfDownload(
  url: string,
  filename: string,
  token: string | null
): Promise<void> {
  const response = await api.get(url, {
    responseType: "blob",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const blob = new Blob([response.data], { type: "application/pdf" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(href);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label
    style={{
      display: "block",
      fontSize: "0.78rem",
      fontWeight: 600,
      color: "var(--cei-text-muted)",
      marginBottom: "0.3rem",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </label>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
    <Label>{label}</Label>
    {children}
  </div>
);

const inputStyle: React.CSSProperties = {
  background: "rgba(15,23,42,0.6)",
  border: "1px solid rgba(148,163,184,0.2)",
  borderRadius: "0.5rem",
  color: "var(--cei-text-main)",
  padding: "0.45rem 0.7rem",
  fontSize: "0.85rem",
  width: "100%",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

// Inline modal (no dependency on Modal.tsx — avoids unknown prop interface)
const PdfModal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => (
  <div
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(2,6,23,0.75)",
      backdropFilter: "blur(4px)",
    }}
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div
      style={{
        background: "var(--cei-surface, #0f172a)",
        border: "1px solid rgba(148,163,184,0.16)",
        borderRadius: "1rem",
        padding: "1.75rem",
        width: "min(480px, 95vw)",
        maxHeight: "90vh",
        overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.25rem",
        }}
      >
        <span style={{ fontSize: "1rem", fontWeight: 700 }}>{title}</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--cei-text-muted)",
            fontSize: "1.2rem",
            cursor: "pointer",
            lineHeight: 1,
            padding: "0.2rem 0.4rem",
          }}
        >
          ×
        </button>
      </div>
      {children}
    </div>
  </div>
);

// Document card
const DocCard: React.FC<{
  icon: string;
  title: string;
  description: string;
  regulation: string;
  onDownload: () => void;
  downloadLabel: string;
}> = ({ icon, title, description, regulation, onDownload, downloadLabel }) => (
  <div
    className="cei-card"
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "0.6rem",
      borderLeft: "3px solid rgba(56,189,248,0.4)",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
      <span style={{ fontSize: "1.4rem" }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>{title}</div>
        <div
          style={{
            fontSize: "0.72rem",
            color: "var(--cei-accent, #38bdf8)",
            fontWeight: 600,
            letterSpacing: "0.05em",
          }}
        >
          {regulation}
        </div>
      </div>
    </div>
    <p
      style={{
        fontSize: "0.8rem",
        color: "var(--cei-text-muted)",
        lineHeight: 1.5,
        margin: 0,
      }}
    >
      {description}
    </p>
    <button
      type="button"
      className="cei-btn cei-btn-primary"
      onClick={onDownload}
      style={{ marginTop: "0.25rem", alignSelf: "flex-start" }}
    >
      {downloadLabel}
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const ComplianceReports: React.FC<Props> = ({ sites, userOrgId }) => {
  const { t, i18n } = useTranslation();
  const { token } = useAuth();
  const lang = normaliseLang(i18n.language);

  const [activeDoc, setActiveDoc] = useState<DocType | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Per-document form state
  const [mrvForm, setMrvForm] = useState<MrvForm>({
    siteId: sites[0] ? String(sites[0].id) : "",
    periodStart: isoDaysAgo(90),
    periodEnd: isoToday(),
    quarter: "",
  });

  const [etsForm, setEtsForm] = useState<EtsForm>({
    year: currentYear(),
  });

  const [enpiForm, setEnpiForm] = useState<EnpiForm>({
    siteId: sites[0] ? String(sites[0].id) : "",
    baselineStart: isoDaysAgo(180),
    baselineEnd: isoDaysAgo(90),
    currentStart: isoDaysAgo(90),
    currentEnd: isoToday(),
  });

  const [corrForm, setCorrForm] = useState<CorrelationForm>({
    siteId: sites[0] ? String(sites[0].id) : "",
    periodStart: isoDaysAgo(90),
    periodEnd: isoToday(),
  });

  const openModal = (doc: DocType) => {
    setDownloadError(null);
    // Refresh siteId defaults if sites loaded after component mount
    if (sites[0]) {
      const firstId = String(sites[0].id);
      setMrvForm((f) => ({ ...f, siteId: f.siteId || firstId }));
      setEnpiForm((f) => ({ ...f, siteId: f.siteId || firstId }));
      setCorrForm((f) => ({ ...f, siteId: f.siteId || firstId }));
    }
    setActiveDoc(doc);
  };

  const closeModal = () => {
    setActiveDoc(null);
    setDownloadError(null);
  };

  // ── Download handlers ────────────────────────────────────────────────────

  const handleMrvDownload = async () => {
    if (!mrvForm.siteId || !mrvForm.periodStart || !mrvForm.periodEnd) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const q = mrvForm.quarter ? `&quarter=${mrvForm.quarter}` : "";
      const url = `/emissions/mrv-report/${mrvForm.siteId}?period_start=${mrvForm.periodStart}&period_end=${mrvForm.periodEnd}${q}&lang=${lang}`;
      const site = sites.find((s) => String(s.id) === mrvForm.siteId);
      await triggerPdfDownload(
        url,
        `CEI_MRV_${site?.name.replace(/\s+/g, "_") ?? mrvForm.siteId}_${mrvForm.periodEnd}.pdf`,
        token
      );
      closeModal();
    } catch (err: any) {
      setDownloadError(
        err?.response?.data?.message ||
          err?.message ||
          "Download failed. Please try again."
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleEtsDownload = async () => {
    if (!userOrgId || !etsForm.year) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const url = `/emissions/ets-statement/${userOrgId}?year=${etsForm.year}&lang=${lang}`;
      await triggerPdfDownload(
        url,
        `CEI_ETS_${etsForm.year}.pdf`,
        token
      );
      closeModal();
    } catch (err: any) {
      setDownloadError(
        err?.response?.data?.message ||
          err?.message ||
          "Download failed. Please try again."
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleEnpiDownload = async () => {
    const { siteId, baselineStart, baselineEnd, currentStart, currentEnd } = enpiForm;
    if (!siteId || !baselineStart || !baselineEnd || !currentStart || !currentEnd) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const url =
        `/emissions/enpi-report/${siteId}` +
        `?baseline_start=${baselineStart}&baseline_end=${baselineEnd}` +
        `&current_start=${currentStart}&current_end=${currentEnd}&lang=${lang}`;
      const site = sites.find((s) => String(s.id) === siteId);
      await triggerPdfDownload(
        url,
        `CEI_EnPI_${site?.name.replace(/\s+/g, "_") ?? siteId}_${currentEnd}.pdf`,
        token
      );
      closeModal();
    } catch (err: any) {
      setDownloadError(
        err?.response?.data?.message ||
          err?.message ||
          "Download failed. Please try again."
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleCorrDownload = async () => {
    const { siteId, periodStart, periodEnd } = corrForm;
    if (!siteId || !periodStart || !periodEnd) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const url = `/analytics/correlations/${siteId}?period_start=${periodStart}&period_end=${periodEnd}&lang=${lang}`;
      const site = sites.find((s) => String(s.id) === siteId);
      await triggerPdfDownload(
        url,
        `CEI_Correlation_${site?.name.replace(/\s+/g, "_") ?? siteId}_${periodEnd}.pdf`,
        token
      );
      closeModal();
    } catch (err: any) {
      setDownloadError(
        err?.response?.data?.message ||
          err?.message ||
          "Download failed. Please try again."
      );
    } finally {
      setDownloading(false);
    }
  };

  // ── Shared form fragments ─────────────────────────────────────────────────

  const SiteSelect: React.FC<{
    value: string;
    onChange: (v: string) => void;
  }> = ({ value, onChange }) => (
    <Field label={lang === "it" ? "Impianto" : "Site"}>
      <select
        style={selectStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {sites.map((s) => (
          <option key={s.id} value={String(s.id)}>
            {s.name}
            {s.location ? ` — ${s.location}` : ""}
          </option>
        ))}
      </select>
    </Field>
  );

  const DateInput: React.FC<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    min?: string;
    max?: string;
  }> = ({ label, value, onChange, min, max }) => (
    <Field label={label}>
      <input
        type="date"
        style={inputStyle}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );

  const ModalFooter: React.FC<{
    onDownload: () => void;
    disabled?: boolean;
  }> = ({ onDownload, disabled }) => (
    <div
      style={{
        marginTop: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      {downloadError && (
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--cei-red, #ef4444)",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "0.5rem",
            padding: "0.5rem 0.75rem",
          }}
        >
          {downloadError}
        </div>
      )}
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="cei-btn cei-btn-ghost"
          onClick={closeModal}
          disabled={downloading}
        >
          {lang === "it" ? "Annulla" : "Cancel"}
        </button>
        <button
          type="button"
          className="cei-btn cei-btn-primary"
          onClick={onDownload}
          disabled={downloading || disabled}
          style={{ minWidth: "120px" }}
        >
          {downloading ? (
            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <LoadingSpinner />
              {lang === "it" ? "Generazione…" : "Generating…"}
            </span>
          ) : lang === "it" ? (
            "Scarica PDF"
          ) : (
            "Download PDF"
          )}
        </button>
      </div>
    </div>
  );

  const formGap: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "0.9rem",
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Section */}
      <section style={{ marginTop: "1.5rem" }}>
        {/* Section header */}
        <div style={{ marginBottom: "0.9rem" }}>
          <h2
            style={{
              fontSize: "1rem",
              fontWeight: 700,
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            {lang === "it" ? "Documenti di Conformità" : "Compliance Documents"}
          </h2>
          <p
            style={{
              marginTop: "0.25rem",
              fontSize: "0.82rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {lang === "it"
              ? `Documenti scaricati in ${lang.toUpperCase()} in base alla lingua selezionata.`
              : `Documents download in ${lang.toUpperCase()} based on your selected language.`}
          </p>
        </div>

        {/* 2×2 card grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "1rem",
          }}
        >
          <DocCard
            icon="📋"
            title={lang === "it" ? "Dichiarazione MRV" : "MRV Declaration"}
            description={
              lang === "it"
                ? "Monitoraggio, Rendicontazione e Verifica delle emissioni incorporate per sito e per periodo. Conforme al Regolamento CBAM (UE) 2023/956."
                : "Monitoring, Reporting and Verification of embedded emissions per site and period. Compliant with EU CBAM Regulation 2023/956."
            }
            regulation="EU CBAM · Reg. (EU) 2023/956"
            onDownload={() => openModal("mrv")}
            downloadLabel={lang === "it" ? "Scarica MRV" : "Download MRV"}
          />

          <DocCard
            icon="⚖️"
            title={
              lang === "it"
                ? "Dichiarazione di Posizione ETS"
                : "ETS Position Statement"
            }
            description={
              lang === "it"
                ? "Posizione ETS annuale dell'organizzazione: quote gratuite, emissioni verificate, surplus/deficit e impatto finanziario stimato."
                : "Annual ETS position for your organisation: free allocation, verified emissions, surplus/deficit and estimated financial impact."
            }
            regulation="EU ETS Phase 4 · Dir. 2003/87/EC"
            onDownload={() => openModal("ets")}
            downloadLabel={lang === "it" ? "Scarica ETS" : "Download ETS"}
          />

          <DocCard
            icon="📊"
            title={lang === "it" ? "Rapporto Baseline EnPI" : "EnPI Baseline Report"}
            description={
              lang === "it"
                ? "Confronto dell'Indicatore di Prestazione Energetica tra un periodo di riferimento e quello corrente con correlazione R²."
                : "Energy Performance Indicator comparison between a baseline and current period with R² statistical correlation."
            }
            regulation="ISO 50001:2018 · Clause 6.4"
            onDownload={() => openModal("enpi")}
            downloadLabel={lang === "it" ? "Scarica EnPI" : "Download EnPI"}
          />

          <DocCard
            icon="🔬"
            title={
              lang === "it"
                ? "Valutazione delle Correlazioni"
                : "Correlation Assessment"
            }
            description={
              lang === "it"
                ? "Analisi statistica: consumo notturno/weekend, frequenza dei picchi, domanda di punta e tendenza mensile con SciPy linregress."
                : "Statistical analysis: night/weekend idle consumption, spike frequency, peak demand and monthly trend with SciPy linregress."
            }
            regulation="CEI Analytics · ISO 14064-1"
            onDownload={() => openModal("correlation")}
            downloadLabel={
              lang === "it" ? "Scarica Correlazioni" : "Download Correlation"
            }
          />
        </div>
      </section>

      {/* ── MRV Modal ───────────────────────────────────────────────────── */}
      {activeDoc === "mrv" && (
        <PdfModal
          title={lang === "it" ? "Dichiarazione MRV" : "MRV Declaration"}
          onClose={closeModal}
        >
          <div style={formGap}>
            <SiteSelect
              value={mrvForm.siteId}
              onChange={(v) => setMrvForm((f) => ({ ...f, siteId: v }))}
            />
            <DateInput
              label={lang === "it" ? "Inizio Periodo" : "Period Start"}
              value={mrvForm.periodStart}
              max={mrvForm.periodEnd}
              onChange={(v) => setMrvForm((f) => ({ ...f, periodStart: v }))}
            />
            <DateInput
              label={lang === "it" ? "Fine Periodo" : "Period End"}
              value={mrvForm.periodEnd}
              min={mrvForm.periodStart}
              max={isoToday()}
              onChange={(v) => setMrvForm((f) => ({ ...f, periodEnd: v }))}
            />
            <Field label={lang === "it" ? "Trimestre (opzionale)" : "Quarter (optional)"}>
              <select
                style={selectStyle}
                value={mrvForm.quarter}
                onChange={(e) =>
                  setMrvForm((f) => ({ ...f, quarter: e.target.value }))
                }
              >
                <option value="">{lang === "it" ? "— Nessuno —" : "— None —"}</option>
                <option value="1">Q1 (Jan–Mar)</option>
                <option value="2">Q2 (Apr–Jun)</option>
                <option value="3">Q3 (Jul–Sep)</option>
                <option value="4">Q4 (Oct–Dec)</option>
              </select>
            </Field>
          </div>
          <ModalFooter
            onDownload={handleMrvDownload}
            disabled={!mrvForm.siteId || !mrvForm.periodStart || !mrvForm.periodEnd}
          />
        </PdfModal>
      )}

      {/* ── ETS Modal ───────────────────────────────────────────────────── */}
      {activeDoc === "ets" && (
        <PdfModal
          title={
            lang === "it"
              ? "Dichiarazione di Posizione ETS"
              : "ETS Position Statement"
          }
          onClose={closeModal}
        >
          <div style={formGap}>
            {!userOrgId && (
              <div
                style={{
                  fontSize: "0.82rem",
                  color: "var(--cei-amber, #f59e0b)",
                  background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.3)",
                  borderRadius: "0.5rem",
                  padding: "0.5rem 0.75rem",
                }}
              >
                {lang === "it"
                  ? "ID organizzazione non disponibile. Effettua nuovamente il login."
                  : "Organisation ID not available. Please log in again."}
              </div>
            )}
            <Field label={lang === "it" ? "Anno di Riferimento" : "Reporting Year"}>
              <input
                type="number"
                style={inputStyle}
                value={etsForm.year}
                min={2021}
                max={new Date().getFullYear()}
                onChange={(e) =>
                  setEtsForm({ year: e.target.value })
                }
              />
            </Field>
            <div
              style={{
                fontSize: "0.78rem",
                color: "var(--cei-text-muted)",
                background: "rgba(56,189,248,0.06)",
                border: "1px solid rgba(56,189,248,0.15)",
                borderRadius: "0.5rem",
                padding: "0.5rem 0.75rem",
                lineHeight: 1.5,
              }}
            >
              {lang === "it"
                ? "Il report ETS aggrega tutti i siti dell'organizzazione per l'anno selezionato."
                : "The ETS report aggregates all sites in your organisation for the selected year."}
            </div>
          </div>
          <ModalFooter
            onDownload={handleEtsDownload}
            disabled={!userOrgId || !etsForm.year}
          />
        </PdfModal>
      )}

      {/* ── EnPI Modal ──────────────────────────────────────────────────── */}
      {activeDoc === "enpi" && (
        <PdfModal
          title={lang === "it" ? "Rapporto Baseline EnPI" : "EnPI Baseline Report"}
          onClose={closeModal}
        >
          <div style={formGap}>
            <SiteSelect
              value={enpiForm.siteId}
              onChange={(v) => setEnpiForm((f) => ({ ...f, siteId: v }))}
            />
            <div
              style={{
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--cei-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                borderBottom: "1px solid rgba(148,163,184,0.15)",
                paddingBottom: "0.3rem",
              }}
            >
              {lang === "it" ? "Periodo di Riferimento" : "Baseline Period"}
            </div>
            <DateInput
              label={lang === "it" ? "Inizio" : "Start"}
              value={enpiForm.baselineStart}
              max={enpiForm.baselineEnd}
              onChange={(v) => setEnpiForm((f) => ({ ...f, baselineStart: v }))}
            />
            <DateInput
              label={lang === "it" ? "Fine" : "End"}
              value={enpiForm.baselineEnd}
              min={enpiForm.baselineStart}
              max={isoToday()}
              onChange={(v) => setEnpiForm((f) => ({ ...f, baselineEnd: v }))}
            />
            <div
              style={{
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--cei-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                borderBottom: "1px solid rgba(148,163,184,0.15)",
                paddingBottom: "0.3rem",
                marginTop: "0.25rem",
              }}
            >
              {lang === "it" ? "Periodo Corrente" : "Current Period"}
            </div>
            <DateInput
              label={lang === "it" ? "Inizio" : "Start"}
              value={enpiForm.currentStart}
              max={enpiForm.currentEnd}
              onChange={(v) => setEnpiForm((f) => ({ ...f, currentStart: v }))}
            />
            <DateInput
              label={lang === "it" ? "Fine" : "End"}
              value={enpiForm.currentEnd}
              min={enpiForm.currentStart}
              max={isoToday()}
              onChange={(v) => setEnpiForm((f) => ({ ...f, currentEnd: v }))}
            />
          </div>
          <ModalFooter
            onDownload={handleEnpiDownload}
            disabled={
              !enpiForm.siteId ||
              !enpiForm.baselineStart ||
              !enpiForm.baselineEnd ||
              !enpiForm.currentStart ||
              !enpiForm.currentEnd
            }
          />
        </PdfModal>
      )}

      {/* ── Correlation Modal ───────────────────────────────────────────── */}
      {activeDoc === "correlation" && (
        <PdfModal
          title={
            lang === "it"
              ? "Valutazione delle Correlazioni"
              : "Correlation Assessment"
          }
          onClose={closeModal}
        >
          <div style={formGap}>
            <SiteSelect
              value={corrForm.siteId}
              onChange={(v) => setCorrForm((f) => ({ ...f, siteId: v }))}
            />
            <DateInput
              label={lang === "it" ? "Inizio Periodo" : "Period Start"}
              value={corrForm.periodStart}
              max={corrForm.periodEnd}
              onChange={(v) => setCorrForm((f) => ({ ...f, periodStart: v }))}
            />
            <DateInput
              label={lang === "it" ? "Fine Periodo" : "Period End"}
              value={corrForm.periodEnd}
              min={corrForm.periodStart}
              max={isoToday()}
              onChange={(v) => setCorrForm((f) => ({ ...f, periodEnd: v }))}
            />
            <div
              style={{
                fontSize: "0.78rem",
                color: "var(--cei-text-muted)",
                background: "rgba(56,189,248,0.06)",
                border: "1px solid rgba(56,189,248,0.15)",
                borderRadius: "0.5rem",
                padding: "0.5rem 0.75rem",
                lineHeight: 1.5,
              }}
            >
              {lang === "it"
                ? "Richiede almeno 30 giorni di dati orari per un'analisi statistica affidabile."
                : "Requires at least 30 days of hourly data for a reliable statistical analysis."}
            </div>
          </div>
          <ModalFooter
            onDownload={handleCorrDownload}
            disabled={
              !corrForm.siteId || !corrForm.periodStart || !corrForm.periodEnd
            }
          />
        </PdfModal>
      )}
    </>
  );
};

export default ComplianceReports;
