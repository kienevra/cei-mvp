import React, { useState } from "react";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import { uploadCsv } from "../services/api";

type UploadResult = any;

const CSVUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [success, setSuccess] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setError(null);
    setSuccess(false);
    setResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a CSV file before uploading.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    setError(null);
    setSuccess(false);
    setResult(null);

    try {
      const res = await uploadCsv(formData);
      setResult(res);
      setSuccess(true);
    } catch (err: any) {
      // Special-case rate limit (429) for a clearer UX
      if (err?.response?.status === 429) {
        setError(
          "You’ve hit the CSV upload limit for this workspace. Please wait a few minutes before trying again."
        );
      } else {
        const backendDetail =
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          err?.message;
        setError(backendDetail || "Upload failed. Please try again.");
      }
    } finally {
      setUploading(false);
    }
  };

  // Try to normalize common result shapes without assuming too much
  const rowsInserted =
    (result as any)?.rows_inserted ??
    (result as any)?.rows_ingested ??
    (result as any)?.inserted ??
    null;
  const rowsFailed =
    (result as any)?.rows_failed ?? (result as any)?.failed ?? null;
  const jobId = (result as any)?.job_id ?? (result as any)?.jobId ?? null;

  return (
    <div className="dashboard-page">
      {/* Header */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "1rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "1.3rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            CSV upload
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Upload batch timeseries data into CEI. This is ideal for pilots,
            historical backfills, and analyst-driven imports.
          </p>
        </div>
      </section>

      {/* Instructions + form */}
      <section className="dashboard-row">
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
            }}
          >
            File requirements
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.1rem",
              fontSize: "0.84rem",
              color: "var(--cei-text-muted)",
              lineHeight: 1.5,
            }}
          >
            <li>Format: CSV, UTF-8 encoded.</li>
            <li>
              Required columns (case-sensitive): <code>site_id</code>,{" "}
              <code>meter_id</code>, <code>timestamp</code>, <code>value</code>
              , <code>unit</code>.
            </li>
            <li>
              Timestamps should be ISO-like, e.g.{" "}
              <code>2025-11-18T07:00:00</code> or{" "}
              <code>2025-11-18 07:00:00</code>.
            </li>
            <li>
              <code>value</code> must be numeric; invalid rows may be rejected
              server-side.
            </li>
          </ul>
        </div>

        <div className="cei-card">
          <form onSubmit={handleSubmit}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              <div>
                <label htmlFor="csvFile">CSV file</label>
                <input
                  id="csvFile"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                />
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Select a CSV file and click <strong>Upload &amp; ingest</strong>
                . Once processed, metrics will appear on the dashboard and site
                views.
              </div>
              <div>
                <button
                  type="submit"
                  className="cei-btn cei-btn-primary"
                  disabled={!file || uploading}
                >
                  {uploading ? "Uploading…" : "Upload & ingest"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>

      {/* Feedback area */}
      <section>
        <div className="cei-card">
          {error && (
            <div style={{ marginBottom: "0.75rem" }}>
              <ErrorBanner message={error} onClose={() => setError(null)} />
            </div>
          )}

          {uploading && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "1rem 0",
              }}
            >
              <LoadingSpinner />
            </div>
          )}

          {!uploading && success && (
            <div
              style={{
                marginBottom: "0.75rem",
                fontSize: "0.85rem",
                color: "var(--cei-text-main)",
              }}
            >
              <div
                style={{
                  marginBottom: "0.3rem",
                  fontWeight: 500,
                }}
              >
                Upload complete.
              </div>
              <div style={{ color: "var(--cei-text-muted)" }}>
                CEI successfully processed the file. You should see the impact
                reflected in recent energy KPIs and time series charts.
              </div>
            </div>
          )}

          {!uploading && (rowsInserted !== null || rowsFailed !== null) && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "1rem",
                marginTop: "0.4rem",
                fontSize: "0.82rem",
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--cei-text-muted)",
                    display: "block",
                  }}
                >
                  Rows ingested
                </span>
                <span style={{ fontWeight: 600 }}>
                  {rowsInserted !== null ? rowsInserted : "—"}
                </span>
              </div>
              <div>
                <span
                  style={{
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--cei-text-muted)",
                    display: "block",
                  }}
                >
                  Rows failed
                </span>
                <span style={{ fontWeight: 600 }}>
                  {rowsFailed !== null ? rowsFailed : "—"}
                </span>
              </div>
              {jobId && (
                <div>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--cei-text-muted)",
                      display: "block",
                    }}
                  >
                    Job id
                  </span>
                  <span style={{ fontFamily: "monospace" }}>{jobId}</span>
                </div>
              )}
            </div>
          )}

          {!uploading && result && (
            <div style={{ marginTop: "0.9rem" }}>
              <button
                type="button"
                className="cei-btn cei-btn-ghost"
                onClick={() => setShowRaw((prev) => !prev)}
              >
                {showRaw ? "Hide raw response" : "Show raw response"}
              </button>
              {showRaw && (
                <pre
                  style={{
                    marginTop: "0.6rem",
                    maxHeight: "260px",
                    overflow: "auto",
                    fontSize: "0.78rem",
                    background: "rgba(15, 23, 42, 0.9)",
                    padding: "0.7rem",
                    borderRadius: "0.6rem",
                    border: "1px solid rgba(31, 41, 55, 0.8)",
                  }}
                >
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          )}

          {!uploading && !error && !result && !success && (
            <div
              style={{
                fontSize: "0.82rem",
                color: "var(--cei-text-muted)",
                marginTop: "0.3rem",
              }}
            >
              No upload performed yet. Select a CSV file and run an ingest to
              populate the CEI engine with data.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default CSVUpload;
