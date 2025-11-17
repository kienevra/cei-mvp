import React, { useState } from "react";
import { uploadCsv } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type UploadStatus = "idle" | "uploading" | "success" | "error";

const CSVUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    setFile(f || null);
    setServerMessage(null);
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
    setServerMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      // If backend requires extra fields (e.g., site_id), we can add them here later.

      const res = await uploadCsv(formData);
      setStatus("success");
      setServerMessage(
        typeof res === "string"
          ? res
          : "File uploaded successfully. Processing may continue in the background."
      );
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
                Supported formats typically include timestamp, value, unit, and
                optional meter/site identifiers. We’ll enforce a strict schema
                later.
              </div>
            </div>
          </div>

          {error && (
            <div style={{ marginBottom: "0.75rem" }}>
              <ErrorBanner message={error} onClose={() => setError(null)} />
            </div>
          )}

          {serverMessage && status === "success" && (
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
              {serverMessage}
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
                Make sure your CSV has a header row and clean timestamps. If
                you’re unsure, start with a small sample file.
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
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
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
