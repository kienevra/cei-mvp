// frontend/src/pages/Support.tsx
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import ErrorBanner from "../components/ErrorBanner";
import LoadingSpinner from "../components/LoadingSpinner";

const CATEGORIES_EN = [
  "Bug report",
  "Feature request",
  "Data / CSV upload issue",
  "Billing question",
  "Account / access issue",
  "Performance issue",
  "Other",
];

const CATEGORIES_IT = [
  "Segnalazione bug",
  "Richiesta funzionalità",
  "Problema dati / caricamento CSV",
  "Domanda sulla fatturazione",
  "Problema account / accesso",
  "Problema di performance",
  "Altro",
];

const Support: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isIt = (i18n.language || "en").toLowerCase().startsWith("it");

  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = isIt ? CATEGORIES_IT : CATEGORIES_EN;

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) {
      setError(isIt ? "Compila tutti i campi obbligatori." : "Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.post("/support/report", {
        category: category || (isIt ? "Altro" : "Other"),
        subject: subject.trim(),
        description: description.trim(),
      });
      setSuccess(true);
      setCategory("");
      setSubject("");
      setDescription("");
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : isIt
          ? "Invio fallito. Riprova o scrivi direttamente a support@carbonefficiencyintel.com"
          : "Submission failed. Please try again or email support@carbonefficiencyintel.com directly."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dashboard-page">
      {/* Header */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
          {isIt ? "Segnala un problema" : "Report a problem"}
        </h1>
        <p style={{ marginTop: "0.3rem", fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
          {isIt
            ? "Hai trovato un bug o vuoi richiedere una funzionalità? Scrivici — risponderemo entro 24 ore."
            : "Found a bug or want to request a feature? Write to us — we'll respond within 24 hours."}
        </p>
      </section>

      {success ? (
        <section>
          <div className="cei-card" style={{ textAlign: "center", padding: "2.5rem" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>✅</div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              {isIt ? "Messaggio inviato!" : "Message sent!"}
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)", marginBottom: "1.5rem" }}>
              {isIt
                ? "Abbiamo ricevuto la tua segnalazione. Ti risponderemo a breve."
                : "We've received your report and will get back to you shortly."}
            </p>
            <button
              type="button"
              className="cei-btn cei-btn-primary"
              onClick={() => setSuccess(false)}
            >
              {isIt ? "Invia un'altra segnalazione" : "Send another report"}
            </button>
          </div>
        </section>
      ) : (
        <section>
          <div className="cei-card" style={{ maxWidth: "600px" }}>
            {error && (
              <div style={{ marginBottom: "1rem" }}>
                <ErrorBanner message={error} onClose={() => setError(null)} />
              </div>
            )}

            {/* Category */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--cei-text-muted)", marginBottom: "0.35rem" }}>
                {isIt ? "Categoria" : "Category"}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">{isIt ? "Seleziona una categoria..." : "Select a category..."}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Subject */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--cei-text-muted)", marginBottom: "0.35rem" }}>
                {isIt ? "Oggetto *" : "Subject *"}
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={isIt ? "Descrivi brevemente il problema..." : "Brief description of the issue..."}
                style={{ width: "100%" }}
              />
            </div>

            {/* Description */}
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--cei-text-muted)", marginBottom: "0.35rem" }}>
                {isIt ? "Descrizione dettagliata *" : "Detailed description *"}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  isIt
                    ? "Descrivi il problema in dettaglio. Includi: cosa stavi facendo, cosa ti aspettavi, cosa è successo invece..."
                    : "Describe the issue in detail. Include: what you were doing, what you expected, what happened instead..."
                }
                rows={6}
                style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem", padding: "0.6rem 0.75rem", borderRadius: "0.5rem", background: "rgba(15,23,42,0.6)", border: "1px solid var(--cei-border-subtle)", color: "var(--cei-text-main)" }}
              />
            </div>

            {/* Direct email note */}
            <div style={{ marginBottom: "1.25rem", padding: "0.65rem 0.85rem", borderRadius: "0.5rem", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", fontSize: "0.78rem", color: "var(--cei-text-muted)" }}>
              {isIt
                ? <>Puoi anche scriverci direttamente a{" "}<a href="mailto:support@carbonefficiencyintel.com" style={{ color: "#22c55e" }}>support@carbonefficiencyintel.com</a></>
                : <>You can also email us directly at{" "}<a href="mailto:support@carbonefficiencyintel.com" style={{ color: "#22c55e" }}>support@carbonefficiencyintel.com</a></>
              }
            </div>

            <button
              type="button"
              className="cei-btn cei-btn-primary"
              onClick={handleSubmit}
              disabled={submitting || !subject.trim() || !description.trim()}
              style={{ width: "100%", opacity: submitting || !subject.trim() || !description.trim() ? 0.6 : 1 }}
            >
              {submitting
                ? (isIt ? "Invio in corso..." : "Sending...")
                : (isIt ? "Invia segnalazione" : "Submit report")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

export default Support;
