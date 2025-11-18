import React, { useState } from "react";
import { uploadCsv } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type UploadStatus = "idle" | "uploading" | "success" | "error";

type UploadResult = {
  rows_received: number;
  rows_ingested: number;
  rows_failed: number;
  errors?: string[];
  sample_site_ids?: string[];
  sample_meter_ids?: string[];
};

const CSVUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    setFile(f || null);
    setResult(null);
    setError(null);
    setStatus("idle");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a CSV file to upload.");
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await uploadCsv(formData);
      setResult(res as UploadResult);
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Upload failed. Please try again.");
    }
  };

  const isUploading = status === "uploading";

  return (
    <div className="dashboard-page">
      {/* Header */}
      <section>
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
            maxWidth: "40rem",
          }}
        >
          Ingest meter, sensor, or utility data from CSV files. CEI will parse
          and map records into timeseries for analytics.
        </p>
      </section>

      {/* Upload card */}
      <section>
        <div className="cei-card">
          <div
            style={{
              marginBottom: "0.8rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Upload CSV file
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Required columns: <code>timestamp</code>, <code>value</code>,{" "}
                <code>unit</code>, <code>site_id</code>, <code>meter_id</code>.
              </div>
            </div>
          </div>

          {error && (
            <div style={{ marginBottom: "0.75rem" }}>
              <ErrorBanner message={error} onClose={() => setError(null)} />
            </div>
          )}

          {status === "success" && result && (
            <div
              style={{
                marginBottom: "0.75rem",
                borderRadius: "0.75rem",
                border: "1px solid rgba(34, 197, 94, 0.5)",
                background: "rgba(22, 163, 74, 0.18)",
                padding: "0.7rem 0.8rem",
                fontSize: "0.8rem",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                Ingestion summary
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  marginBottom: "0.4rem",
                }}
              >
                <div>
                  <span style={{ opacity: 0.7 }}>Rows received:</span>{" "}
                  <strong>{result.rows_received}</strong>
                </div>
                <div>
                  <span style={{ opacity: 0.7 }}>Rows ingested:</span>{" "}
                  <strong>{result.rows_ingested}</strong>
                </div>
                <div>
                  <span style={{ opacity: 0.7 }}>Rows failed:</span>{" "}
                  <strong>{result.rows_failed}</strong>
                </div>
              </div>

              {(result.sample_site_ids?.length || 0) > 0 && (
                <div style={{ marginBottom: "0.25rem" }}>
                  <span style={{ opacity: 0.7 }}>Sites seen:</span>{" "}
                  <code>{result.sample_site_ids!.join(", ")}</code>
                </div>
              )}

              {(result.sample_meter_ids?.length || 0) > 0 && (
                <div style={{ marginBottom: "0.25rem" }}>
                  <span style={{ opacity: 0.7 }}>Meters seen:</span>{" "}
                  <code>{result.sample_meter_ids!.join(", ")}</code>
                </div>
              )}

              {(result.errors?.length || 0) > 0 && (
                <div style={{ marginTop: "0.4rem" }}>
                  <div style={{ fontWeight: 500, marginBottom: "0.2rem" }}>
                    Sample errors (first {result.errors!.length}):
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: "1.1rem",
                      fontSize: "0.78rem",
                    }}
                  >
                    {result.errors!.map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <form onSubmit={onSubmit}>
            <div
              style={{
                borderRadius: "0.9rem",
                border: "1px dashed rgba(148, 163, 184, 0.6)",
                padding: "1rem",
                background:
                  "radial-gradient(circle at top left, rgba(56, 189, 248, 0.12), rgba(15, 23, 42, 0.95))",
                display: "flex",
                flexDirection: "column",
                gap: "0.6rem",
              }}
            >
              <div>
                <label htmlFor="csvFile">CSV file</label>
                <input
                  id="csvFile"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFileChange}
                />
              </div>

              <div
                style={{
                  marginTop: "0.3rem",
                  fontSize: "0.78rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Make sure your CSV has a header row and clean timestamps
                (ISO8601 or{" "}
                <code style={{ fontSize: "0.78rem" }}>
                  YYYY-MM-DD HH:MM:SS
                </code>
                ). If you&apos;re unsure, start with a small sample file.
              </div>

              <div
                style={{
                  marginTop: "0.5rem",
                  display: "flex",
                  justifyContent: "flex-start",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <button
                  type="submit"
                  className="cei-btn cei-btn-primary"
                  disabled={isUploading}
                >
                  {isUploading ? "Uploading…" : "Upload file"}
                </button>
                {isUploading && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.25rem",
                    }}
                  >
                    <LoadingSpinner />
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--cei-text-muted)",
                      }}
                    >
                      Sending file to CEI…
                    </span>
                  </div>
                )}
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
};

export default CSVUpload;
