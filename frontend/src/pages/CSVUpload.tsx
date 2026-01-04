// frontend/src/pages/CSVUpload.tsx
import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { uploadCsv } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import { useTranslation, Trans } from "react-i18next";

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

type UploadStatus = "idle" | "ready" | "validating" | "ingesting" | "done" | "error";

const STORAGE_KEY_BASE = "cei_last_upload_result";

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

/** Pull request_id from axios-ish errors and append as a Support code for the ErrorBanner. */
function getSupportCodeFromError(err: any): string | null {
  if (!err) return null;

  // Preferred: api.ts stamps this on AxiosError instances
  const stamped = typeof err?.cei_request_id === "string" ? err.cei_request_id : null;
  if (stamped && stamped.trim()) return stamped.trim();

  // Fallback: response header / body (common patterns)
  const headers: any = err?.response?.headers || {};
  const fromHeader =
    (typeof headers["x-request-id"] === "string" && headers["x-request-id"]) ||
    (typeof headers["X-Request-ID"] === "string" && headers["X-Request-ID"]) ||
    null;
  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();

  const data: any = err?.response?.data;
  const fromBody =
    typeof data?.request_id === "string"
      ? data.request_id
      : typeof data?.requestId === "string"
      ? data.requestId
      : null;
  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();

  return null;
}

function appendSupportCode(msg: string, rid: string | null): string {
  if (!rid) return msg;
  if (msg && msg.toLowerCase().includes("support code:")) return msg;
  return `${msg} (Support code: ${rid})`;
}

function getUploadErrorMessage(e: any, t: (key: string, opts?: any) => string): string {
  const rid = getSupportCodeFromError(e);

  const msg =
    e?.response?.data?.detail?.message ||
    e?.response?.data?.detail ||
    e?.message ||
    t("csvUpload.errors.uploadFailedGeneric", {
      defaultValue: "Upload failed. Please check the file and try again.",
    });

  return appendSupportCode(String(msg), rid);
}

const CSVUpload: React.FC = () => {
  const { t } = useTranslation();

  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const forcedSiteId = params.get("site_id");
  const isPerSiteMode = !!forcedSiteId;
  const storageKey = isPerSiteMode
    ? `${STORAGE_KEY_BASE}_${forcedSiteId}`
    : STORAGE_KEY_BASE;

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvUploadBackendResult | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<StoredUploadSnapshot | null>(
    null
  );

  // Load last successful upload snapshot from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredUploadSnapshot;
      if (parsed && typeof parsed.completedAt === "string") {
        setLastSnapshot(parsed);
      }
    } catch {
      // ignore
    }
  }, [storageKey]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setResult(null);

    if (!e.target.files || e.target.files.length === 0) {
      setFile(null);
      setStatus("idle");
      return;
    }

    const f = e.target.files[0];
    setFile(f);
    setStatus("ready");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError(t("csvUpload.errors.noFileSelected", { defaultValue: "Please choose a CSV file to upload." }));
      setStatus("error");
      return;
    }

    try {
      // Pipeline-style states, even though it's a single backend call
      setStatus("validating");

      const formData = new FormData();
      formData.append("file", file);

      // If we have a forced site_id from the URL, route all rows to that site.
      const data = (await uploadCsv(
        formData,
        forcedSiteId ? { siteId: forcedSiteId } : undefined
      )) as CsvUploadBackendResult;

      // Briefly mark as "ingesting" to show intent, then "done"
      setStatus("ingesting");
      setResult(data);

      const snapshot: StoredUploadSnapshot = {
        ...data,
        completedAt: new Date().toISOString(),
      };

      setLastSnapshot(snapshot);

      try {
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
      } catch {
        // ignore storage failures
      }

      setStatus("done");
    } catch (e: any) {
      setError(getUploadErrorMessage(e, t));
      setStatus("error");
    }
  };

  const successRate =
    result && result.rows_received > 0
      ? (result.rows_ingested / result.rows_received) * 100
      : null;

  const lastCompletedLabel = lastSnapshot
    ? formatDateTimeLabel(lastSnapshot.completedAt)
    : null;

  const isBusy = status === "validating" || status === "ingesting";

  const buttonLabel =
    status === "validating"
      ? t("csvUpload.button.validating", { defaultValue: "Validating & ingesting…" })
      : status === "ingesting"
      ? t("csvUpload.button.ingesting", { defaultValue: "Ingesting…" })
      : status === "done"
      ? t("csvUpload.button.uploadAgain", { defaultValue: "Upload again" })
      : t("csvUpload.button.uploadCsv", { defaultValue: "Upload CSV" });

  const statusLabel = (() => {
    switch (status) {
      case "idle":
        return t("csvUpload.status.idle", { defaultValue: "Waiting for a CSV file." });
      case "ready":
        return file
          ? t("csvUpload.status.readyWithFile", {
              defaultValue: "Ready to upload: {{name}}",
              name: file.name,
            })
          : t("csvUpload.status.idle", { defaultValue: "Waiting for a CSV file." });
      case "validating":
        return t("csvUpload.status.validating", {
          defaultValue: "Validating headers and preparing rows for ingestion…",
        });
      case "ingesting":
        return t("csvUpload.status.ingesting", {
          defaultValue: "Ingesting rows into the timeseries engine…",
        });
      case "done":
        return isPerSiteMode
          ? t("csvUpload.status.donePerSite", {
              defaultValue:
                "Upload complete. The latest data will feed this site’s charts, alerts, and reports.",
            })
          : t("csvUpload.status.doneGlobal", {
              defaultValue:
                "Upload complete. The latest data will feed Dashboard, SiteView, Alerts, and Reports.",
            });
      case "error":
        return t("csvUpload.status.error", {
          defaultValue: "Upload failed. Review the error message and adjust the CSV.",
        });
      default:
        return null;
    }
  })();

  const endpointLabel = isPerSiteMode
    ? `/api/v1/upload-csv?site_id=${forcedSiteId}`
    : "/api/v1/upload-csv";

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
            {isPerSiteMode
              ? t("csvUpload.title.perSite", {
                  defaultValue: "Upload timeseries data for this site",
                })
              : t("csvUpload.title.global", {
                  defaultValue: "Upload timeseries data",
                })}
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {isPerSiteMode ? (
              <Trans
                i18nKey="csvUpload.subtitle.perSite"
                defaults={
                  "You&apos;re uploading data for <code>{{forcedSiteId}}</code>. CEI will ingest all rows into this site. Column <code>order</code> doesn&apos;t matter; the engine reads the header row. For this scoped upload, your CSV must include at least <code>timestamp</code>, <code>value</code>, <code>unit</code>, and <code>meter_id</code>. A <code>site_id</code> column is optional and will be ignored for routing."
                }
                values={{ forcedSiteId }}
                components={{ code: <code /> }}
              />
            ) : (
              <Trans
                i18nKey="csvUpload.subtitle.global"
                defaults={
                  "Drag a CSV into CEI and we&apos;ll ingest energy readings into the timeseries engine. Column <code>order doesn&apos;t matter</code> as long as the headers include <code>timestamp</code>, <code>value</code>, <code>unit</code>, <code>site_id</code>, and <code>meter_id</code>."
                }
                components={{ code: <code /> }}
              />
            )}
          </p>
          {isPerSiteMode && (
            <div
              style={{
                marginTop: "0.4rem",
                fontSize: "0.78rem",
                color: "var(--cei-text-accent)",
              }}
            >
              <Trans
                i18nKey="csvUpload.scopedMode"
                defaults={"Scoped mode: all ingested rows will use <code>site_id = {{forcedSiteId}}</code>."}
                values={{ forcedSiteId }}
                components={{ code: <code /> }}
              />
            </div>
          )}
        </div>
        <div
          style={{
            textAlign: "right",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          <div>
            {t("csvUpload.meta.endpoint", { defaultValue: "Endpoint:" })} {endpointLabel}
          </div>
          <div>{t("csvUpload.meta.authRequired", { defaultValue: "Auth: required" })}</div>
          {lastSnapshot && lastCompletedLabel && (
            <div style={{ marginTop: "0.35rem" }}>
              <div style={{ fontSize: "0.78rem" }}>
                {t("csvUpload.meta.lastSuccessful", {
                  defaultValue: "Last successful upload",
                })}
                {isPerSiteMode
                  ? t("csvUpload.meta.scopeSuffix", { defaultValue: " (this scope)" })
                  : ""}
              </div>
              <div style={{ fontSize: "0.78rem" }}>
                <span style={{ color: "var(--cei-text-accent)" }}>
                  {lastCompletedLabel}
                </span>
                {", "}
                <Trans
                  i18nKey="csvUpload.meta.ingestedSummary"
                  defaults={"ingested <strong>{{ingested}}</strong> / {{received}} rows."}
                  values={{
                    ingested: lastSnapshot.rows_ingested.toLocaleString(),
                    received: lastSnapshot.rows_received.toLocaleString(),
                  }}
                  components={{ strong: <strong /> }}
                />
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
                <label htmlFor="csv-file">
                  {t("csvUpload.form.csvFileLabel", { defaultValue: "CSV file" })}
                </label>
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
                  {t("csvUpload.form.mappingIntro", {
                    defaultValue:
                      "CEI will read the header row and map columns by name. The engine expects at least:",
                  })}
                  <ul
                    style={{
                      margin: "0.4rem 0 0",
                      paddingLeft: "1.1rem",
                      fontSize: "0.8rem",
                    }}
                  >
                    <li>
                      <code>timestamp</code> –{" "}
                      <Trans
                        i18nKey="csvUpload.form.timestampHint"
                        defaults={"ISO 8601 or <code>YYYY-MM-DD HH:MM:SS</code>"}
                        components={{ code: <code /> }}
                      />
                    </li>
                    <li>
                      <code>value</code> – {t("csvUpload.form.valueHint", { defaultValue: "numeric reading" })}
                    </li>
                    <li>
                      <code>unit</code> –{" "}
                      <Trans
                        i18nKey="csvUpload.form.unitHint"
                        defaults={"e.g. <code>kWh</code>"}
                        components={{ code: <code /> }}
                      />
                    </li>
                    {!isPerSiteMode && (
                      <li>
                        <code>site_id</code> –{" "}
                        <Trans
                          i18nKey="csvUpload.form.siteIdHint"
                          defaults={"e.g. <code>site-1</code>"}
                          components={{ code: <code /> }}
                        />
                      </li>
                    )}
                    <li>
                      <code>meter_id</code> –{" "}
                      <Trans
                        i18nKey="csvUpload.form.meterIdHint"
                        defaults={
                          "e.g. <code>meter-main-1</code> (if omitted, CEI will default to a generic meter id)"
                        }
                        components={{ code: <code /> }}
                      />
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
                  {t("csvUpload.tips.title", { defaultValue: "Tips for smooth ingestion" })}
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: "1.1rem",
                    lineHeight: 1.6,
                  }}
                >
                  <li>{t("csvUpload.tips.item1", { defaultValue: "Keep timestamps in a single timezone per file." })}</li>
                  <li>
                    <Trans
                      i18nKey="csvUpload.tips.item2Base"
                      defaults={
                        "Use stable <code>site_id</code> values so dashboards can build trends over time."
                      }
                      components={{ code: <code /> }}
                    />
                    {isPerSiteMode && (
                      <>
                        {" "}
                        <Trans
                          i18nKey="csvUpload.tips.item2Scoped"
                          defaults={
                            "For this scoped upload CEI will enforce <code>{{forcedSiteId}}</code> on every row."
                          }
                          values={{ forcedSiteId }}
                          components={{ code: <code /> }}
                        />
                      </>
                    )}
                  </li>
                  <li>
                    {t("csvUpload.tips.item3", {
                      defaultValue:
                        "If you backfill older data, it will not change the “last 24 hours” KPIs but will appear in broader windows later.",
                    })}
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
                disabled={isBusy || !file}
              >
                {buttonLabel}
              </button>
              {isBusy && <LoadingSpinner />}
              {statusLabel && (
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  {statusLabel}
                </div>
              )}
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
                {t("csvUpload.result.title", { defaultValue: "Ingestion summary" })}
              </div>
              <div
                style={{
                  fontSize: "0.82rem",
                  color: "var(--cei-text-muted)",
                  marginBottom: "0.45rem",
                }}
              >
                <Trans
                  i18nKey="csvUpload.result.summary"
                  defaults={
                    "CEI received <strong>{{received}}</strong> row{{pluralSuffix}}, ingested <strong>{{ingested}}</strong>, and skipped <strong>{{failed}}</strong>."
                  }
                  values={{
                    received: result.rows_received.toLocaleString(),
                    ingested: result.rows_ingested.toLocaleString(),
                    failed: result.rows_failed.toLocaleString(),
                    pluralSuffix: result.rows_received === 1 ? "" : "s",
                  }}
                  components={{ strong: <strong /> }}
                />
                {successRate !== null && (
                  <>
                    {" "}
                    <Trans
                      i18nKey="csvUpload.result.successRate"
                      defaults={"Effective success rate: <strong>{{rate}}</strong>."}
                      values={{ rate: `${successRate.toFixed(1)}%` }}
                      components={{ strong: <strong /> }}
                    />
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
                    {t("csvUpload.result.sampleSiteIds", { defaultValue: "Sample site_ids" })}
                  </div>
                  {result.sample_site_ids.length === 0 ? (
                    <div>{t("csvUpload.result.noneDetected", { defaultValue: "None detected" })}</div>
                  ) : (
                    <div>{result.sample_site_ids.join(", ")}</div>
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
                    {t("csvUpload.result.sampleMeterIds", { defaultValue: "Sample meter_ids" })}
                  </div>
                  {result.sample_meter_ids.length === 0 ? (
                    <div>{t("csvUpload.result.noneDetected", { defaultValue: "None detected" })}</div>
                  ) : (
                    <div>{result.sample_meter_ids.join(", ")}</div>
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
                    {t("csvUpload.result.sampleIssues", {
                      defaultValue:
                        "Sample row-level issues (first {{count}}):",
                      count: result.errors.length,
                    })}
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
