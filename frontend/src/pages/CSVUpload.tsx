// frontend/src/pages/CSVUpload.tsx
import React, { useEffect, useState } from "react";
import { uploadCsv } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type CsvUploadBackendResult = {
  rows_received: number;
  rows_ingested: number;
  rows_failed: number;
  errors: string[];
  sample_site_ids: string[];
  sample_meter_ids: string[];
};

type StoredUploadSnapshot = CsvUploadBackendResult & {
  completedAt: string; // ISO timestamp stored on the client
};

const STORAGE_KEY = "cei_last_upload_result";

function formatDateTimeLabel(raw?: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CSVUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvUploadBackendResult | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<StoredUploadSnapshot | null>(
    null
  );

  // Load last successful upload snapshot from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredUploadSnapshot;
      if (parsed && typeof parsed.completedAt === "string") {
        setLastSnapshot(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setResult(null);
    if (!e.target.files || e.target.files.length === 0) {
      setFile(null);
      return;
    }
    const f = e.target.files[0];
    setFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Please choose a CSV file to upload.");
      return;
    }

    try {
      setUploading(true);

      const formData = new FormData();
      formData.append("file", file);

      const data = (await uploadCsv(formData)) as CsvUploadBackendResult;
      setResult(data);

      const snapshot: StoredUploadSnapshot = {
        ...data,
        completedAt: new Date().toISOString(),
      };

      setLastSnapshot(snapshot);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // ignore storage failures
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        "Upload failed. Please check the file and try again.";
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const successRate =
    result && result.rows_received > 0
      ? (result.rows_ingested / result.rows_received) * 100
      : null;

  const lastCompletedLabel = lastSnapshot
    ? formatDateTimeLabel(lastSnapshot.completedAt)
    : null;

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
            Upload timeseries data
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Drag a CSV into CEI and we&apos;ll ingest energy readings into the
            timeseries engine. Column{" "}
            <code>order doesn&apos;t matter</code> as long as the headers
            include <code>timestamp</code>, <code>value</code>,{" "}
            <code>unit</code>, <code>site_id</code>, and <code>meter_id</code>.
          </p>
        </div>
        <div
          style={{
            textAlign: "right",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          <div>Endpoint: /api/v1/upload-csv</div>
          <div>Auth: required</div>
          {lastSnapshot && lastCompletedLabel && (
            <div style={{ marginTop: "0.35rem" }}>
              <div style={{ fontSize: "0.78rem" }}>Last successful upload</div>
              <div style={{ fontSize: "0.78rem" }}>
                <span style={{ color: "var(--cei-text-accent)" }}>
                  {lastCompletedLabel}
                </span>
                {", "}
                ingested{" "}
                <strong>{lastSnapshot.rows_ingested.toLocaleString()}</strong> /
                {lastSnapshot.rows_received.toLocaleString()} rows.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Error banner */}
      {error && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </section>
      )}

      {/* Main card */}
      <section style={{ marginTop: "0.9rem" }}>
        <div className="cei-card">
          {/* Upload form */}
          <form onSubmit={handleSubmit}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)",
                gap: "1rem",
                alignItems: "flex-start",
              }}
            >
              {/* Left: file picker */}
              <div>
                <label htmlFor="csv-file">CSV file</label>
                <input
                  id="csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                />
                <div
                  style={{
                    marginTop: "0.35rem",
                    fontSize: "0.8rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  CEI will read the header row and map columns by name. The
                  engine expects at least:
                  <ul
                    style={{
                      margin: "0.4rem 0 0",
                      paddingLeft: "1.1rem",
                      fontSize: "0.8rem",
                    }}
                  >
                    <li>
                      <code>timestamp</code> – ISO 8601 or{" "}
                      <code>YYYY-MM-DD HH:MM:SS</code>
                    </li>
                    <li>
                      <code>value</code> – numeric reading
                    </li>
                    <li>
                      <code>unit</code> – e.g. <code>kWh</code>
                    </li>
                    <li>
                      <code>site_id</code> – e.g. <code>site-1</code>
                    </li>
                    <li>
                      <code>meter_id</code> – e.g. <code>meter-main-1</code>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Right: call-to-action and hints */}
              <div
                style={{
                  fontSize: "0.82rem",
                  color: "var(--cei-text-muted)",
                  borderLeft: "1px solid rgba(31, 41, 55, 0.8)",
                  paddingLeft: "0.85rem",
                }}
              >
                <div style={{ marginBottom: "0.4rem", fontWeight: 500 }}>
                  Tips for smooth ingestion
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: "1.1rem",
                    lineHeight: 1.6,
                  }}
                >
                  <li>Keep timestamps in a single timezone per file.</li>
                  <li>
                    Use stable <code>site_id</code> values so dashboards can
                    build trends over time.
                  </li>
                  <li>
                    If you backfill older data, it will not change the “last 24
                    hours” KPIs but will appear in broader windows later.
                  </li>
                </ul>
              </div>
            </div>

            <div
              style={{
                marginTop: "1.2rem",
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <button
                type="submit"
                className="cei-btn cei-btn-primary"
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "Upload CSV"}
              </button>
              {uploading && <LoadingSpinner />}
            </div>
          </form>

          {/* Result panel */}
          {result && (
            <div
              style={{
                marginTop: "1.3rem",
                paddingTop: "0.9rem",
                borderTop: "1px solid rgba(31, 41, 55, 0.8)",
              }}
            >
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  marginBottom: "0.35rem",
                }}
              >
                Ingestion summary
              </div>
              <div
                style={{
                  fontSize: "0.82rem",
                  color: "var(--cei-text-muted)",
                  marginBottom: "0.45rem",
                }}
              >
                CEI received{" "}
                <strong>{result.rows_received.toLocaleString()}</strong> row
                {result.rows_received === 1 ? "" : "s"}, ingested{" "}
                <strong>{result.rows_ingested.toLocaleString()}</strong>, and
                skipped{" "}
                <strong>{result.rows_failed.toLocaleString()}</strong>.
                {successRate !== null && (
                  <>
                    {" "}
                    Effective success rate:{" "}
                    <strong>{successRate.toFixed(1)}%</strong>.
                  </>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "1.5rem",
                  fontSize: "0.8rem",
                }}
              >
                <div>
                  <div
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      fontSize: "0.72rem",
                      color: "var(--cei-text-muted)",
                      marginBottom: "0.2rem",
                    }}
                  >
                    Sample site_ids
                  </div>
                  {result.sample_site_ids.length === 0 ? (
                    <div>None detected</div>
                  ) : (
                    <div>
                      {result.sample_site_ids.join(", ")}
                    </div>
                  )}
                </div>

                <div>
                  <div
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      fontSize: "0.72rem",
                      color: "var(--cei-text-muted)",
                      marginBottom: "0.2rem",
                    }}
                  >
                    Sample meter_ids
                  </div>
                  {result.sample_meter_ids.length === 0 ? (
                    <div>None detected</div>
                  ) : (
                    <div>
                      {result.sample_meter_ids.join(", ")}
                    </div>
                  )}
                </div>
              </div>

              {result.errors.length > 0 && (
                <div
                  style={{
                    marginTop: "0.9rem",
                    fontSize: "0.8rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  <div
                    style={{
                      marginBottom: "0.3rem",
                      fontWeight: 500,
                    }}
                  >
                    Sample row-level issues (first {result.errors.length}):
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: "1.1rem",
                      lineHeight: 1.5,
                    }}
                  >
                    {result.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default CSVUpload;
