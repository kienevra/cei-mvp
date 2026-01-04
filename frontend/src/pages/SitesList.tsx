// frontend/src/pages/SitesList.tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSites, createSite, getSiteKpi, deleteSite } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type SiteRecord = {
  id: number | string;
  name: string;
  location?: string | null;
  [key: string]: any;
};

type SiteTrendMetrics = {
  totalKwh24h: number;
  deviationPct24h: number | null;
  expectedKwh24h: number | null;

  isBaselineWarmingUp?: boolean;
  totalHistoryDays?: number | null;
};

const SitesList: React.FC = () => {
  const { t } = useTranslation();

  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [siteMetrics, setSiteMetrics] = useState<Record<string, SiteTrendMetrics>>(
    {}
  );

  useEffect(() => {
    let isMounted = true;

    async function loadSites() {
      setLoading(true);
      setError(null);
      try {
        const data = await getSites();
        if (!isMounted) return;

        const normalized = Array.isArray(data) ? (data as SiteRecord[]) : [];
        setSites(normalized);

        if (normalized.length > 0) {
          const entries = await Promise.all(
            normalized.map(async (site: SiteRecord) => {
              const idStr = String(site.id);
              const siteKey = `site-${idStr}`;

              let metrics: SiteTrendMetrics = {
                totalKwh24h: 0,
                deviationPct24h: null,
                expectedKwh24h: null,
              };

              try {
                // Call analytics with logical site key, NOT numeric ID
                const kpi: any = await getSiteKpi(siteKey);

                const total24 =
                  typeof kpi?.last_24h_kwh === "number" ? kpi.last_24h_kwh : 0;

                const dev24 =
                  typeof kpi?.deviation_pct_24h === "number" &&
                  Number.isFinite(kpi.deviation_pct_24h)
                    ? kpi.deviation_pct_24h
                    : null;

                const expected24 =
                  typeof kpi?.baseline_24h_kwh === "number" &&
                  Number.isFinite(kpi.baseline_24h_kwh)
                    ? kpi.baseline_24h_kwh
                    : null;

                const isBaselineWarmingUpFromApi =
                  typeof kpi?.is_baseline_warming_up === "boolean"
                    ? Boolean(kpi.is_baseline_warming_up)
                    : undefined;

                const totalHistoryDaysFromApi =
                  typeof kpi?.total_history_days === "number"
                    ? kpi.total_history_days
                    : undefined;

                const heuristicWarmingUp =
                  isBaselineWarmingUpFromApi === undefined &&
                  total24 > 0 &&
                  (dev24 === null || expected24 === null);

                metrics = {
                  totalKwh24h: total24,
                  deviationPct24h: dev24,
                  expectedKwh24h: expected24,
                  isBaselineWarmingUp: isBaselineWarmingUpFromApi ?? heuristicWarmingUp,
                  totalHistoryDays:
                    totalHistoryDaysFromApi !== undefined ? totalHistoryDaysFromApi : null,
                };
              } catch {
                metrics = {
                  totalKwh24h: 0,
                  deviationPct24h: null,
                  expectedKwh24h: null,
                  isBaselineWarmingUp: false,
                  totalHistoryDays: null,
                };
              }

              // Key metrics by siteKey, not bare id
              return [siteKey, metrics] as const;
            })
          );

          if (!isMounted) return;

          const metricsMap: Record<string, SiteTrendMetrics> = {};
          for (const [siteKey, metrics] of entries) {
            metricsMap[siteKey] = metrics;
          }
          setSiteMetrics(metricsMap);
        }
      } catch (e: any) {
        if (!isMounted) return;
        setError(
          e?.response?.data?.detail ||
            e?.message ||
            t("sitesList.errors.load", { defaultValue: "Failed to load sites." })
        );
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    loadSites();

    return () => {
      isMounted = false;
    };
  }, [t]);

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setCreateError(
        t("sitesList.errors.nameRequired", { defaultValue: "Site name is required." })
      );
      return;
    }
    setCreateError(null);
    setCreating(true);

    try {
      const payload = {
        name: newName.trim(),
        location: newLocation.trim() || undefined,
      };
      const created = (await createSite(payload)) as SiteRecord;

      setSites((prev: SiteRecord[]) => [...prev, created]);

      setNewName("");
      setNewLocation("");
    } catch (err: any) {
      setCreateError(
        err?.response?.data?.detail ||
          err?.message ||
          t("sitesList.errors.create", { defaultValue: "Failed to create site." })
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSite = async (id: number | string, name?: string) => {
    const idStr = String(id);
    const label =
      name ||
      t("sitesList.row.defaultSiteName", { defaultValue: "Site {{id}}", id: idStr });

    const confirmed = window.confirm(
      t("sitesList.confirmDelete.full", {
        defaultValue:
          "Delete {{label}}?\n\nThis will permanently remove this site and its associated data in CEI.",
        label,
      })
    );
    if (!confirmed) return;

    try {
      await deleteSite(id);

      const siteKey = `site-${idStr}`;

      setSites((prev: SiteRecord[]) => prev.filter((s) => String(s.id) !== idStr));

      setSiteMetrics((prev: Record<string, SiteTrendMetrics>) => {
        const next = { ...prev };
        delete next[siteKey];
        return next;
      });
    } catch (e: any) {
      console.error("Failed to delete site", e);
      alert(
        e?.response?.data?.detail ||
          t("sitesList.errors.delete", {
            defaultValue: "Failed to delete site. Please try again or check logs.",
          })
      );
    }
  };

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
            {t("sitesList.header.title", { defaultValue: "Sites" })}
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {t("sitesList.header.subtitle", {
              defaultValue:
                "Manage the plants, facilities, and lines you're monitoring. Sites are the anchor for dashboards, alerts, and reports.",
            })}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "0.4rem",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          <Link to="/upload">
            <button className="cei-btn cei-btn-ghost">
              {t("sitesList.actions.goToUpload", { defaultValue: "Go to CSV upload" })}
            </button>
          </Link>
        </div>
      </section>

      {/* Error banner */}
      {error && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </section>
      )}

      {/* Add site card */}
      <section className="dashboard-row">
        <div className="cei-card">
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
            {t("sitesList.addCard.title", { defaultValue: "Add a site" })}
          </div>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              marginBottom: "0.6rem",
            }}
          >
            {t("sitesList.addCard.body", {
              defaultValue:
                "Create sites for your organization so that uploaded meters and alerts can be anchored to real facilities.",
            })}
          </p>

          <form
            onSubmit={handleCreateSite}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.6rem",
              alignItems: "flex-end",
            }}
          >
            <div style={{ flex: "1 1 160px", minWidth: "160px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.78rem",
                  marginBottom: "0.25rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                {t("sitesList.addCard.siteNameLabel", { defaultValue: "Site name *" })}
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("sitesList.addCard.siteNamePlaceholder", {
                  defaultValue: "e.g. Lamborghini Bologna",
                })}
                style={{
                  width: "100%",
                  padding: "0.4rem 0.5rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--cei-border-subtle)",
                  background: "rgba(15,23,42,0.9)",
                  color: "#e5e7eb",
                  fontSize: "0.85rem",
                }}
              />
            </div>

            <div style={{ flex: "1 1 160px", minWidth: "160px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.78rem",
                  marginBottom: "0.25rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                {t("sitesList.addCard.locationLabel", {
                  defaultValue: "Location (optional)",
                })}
              </label>
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder={t("sitesList.addCard.locationPlaceholder", {
                  defaultValue: "e.g. Bologna, IT",
                })}
                style={{
                  width: "100%",
                  padding: "0.4rem 0.5rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--cei-border-subtle)",
                  background: "rgba(15,23,42,0.9)",
                  color: "#e5e7eb",
                  fontSize: "0.85rem",
                }}
              />
            </div>

            <div>
              <button type="submit" className="cei-btn cei-btn-primary" disabled={creating}>
                {creating
                  ? t("sitesList.addCard.creating", { defaultValue: "Creating…" })
                  : t("sitesList.addCard.add", { defaultValue: "Add site" })}
              </button>
            </div>
          </form>

          {createError && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "#f97373" }}>
              {createError}
            </div>
          )}
        </div>
      </section>

      {/* Sites table */}
      <section>
        <div className="cei-card">
          <div
            style={{
              marginBottom: "0.7rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                {t("sitesList.table.title", { defaultValue: "Sites in your organization" })}
              </div>
              <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
                {t("sitesList.table.subtitlePrefix", {
                  defaultValue:
                    "Click the site ID or name to open its dashboard. Upload CSVs keyed to",
                })}{" "}
                <code>site-&lt;id&gt;</code>{" "}
                {t("sitesList.table.subtitleSuffix", {
                  defaultValue: "to drive trends, alerts, and reports.",
                })}
              </div>
            </div>
          </div>

          {loading && (
            <div style={{ padding: "1.2rem 0.5rem", display: "flex", justifyContent: "center" }}>
              <LoadingSpinner />
            </div>
          )}

          {!loading && sites.length === 0 && (
            <div style={{ fontSize: "0.85rem", color: "var(--cei-text-muted)" }}>
              {t("sitesList.table.empty", {
                defaultValue:
                  "No sites yet. Use the form above to create your first site, then upload timeseries data linked to site-1, site-2, etc.",
              })}
            </div>
          )}

          {!loading && sites.length > 0 && (
            <div style={{ marginTop: "0.5rem", overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>{t("sitesList.table.columns.id", { defaultValue: "ID" })}</th>
                    <th>{t("sitesList.table.columns.site", { defaultValue: "Site" })}</th>
                    <th>{t("sitesList.table.columns.location", { defaultValue: "Location" })}</th>
                    <th>{t("sitesList.table.columns.trend24h", { defaultValue: "Last 24h trend" })}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site: SiteRecord) => {
                    const idStr = String(site.id);
                    const siteKey = `site-${idStr}`;

                    const name =
                      site.name ||
                      t("sitesList.row.defaultSiteName", {
                        defaultValue: "Site {{id}}",
                        id: idStr,
                      });

                    const location =
                      site.location ||
                      t("sitesList.row.unknownLocation", { defaultValue: "—" });

                    const metrics = siteMetrics[siteKey];

                    let trendLabel = t("sitesList.trend.no24hDataYet", {
                      defaultValue: "No 24h data yet",
                    });
                    let pillClassName = "cei-pill cei-pill-neutral";

                    if (metrics && metrics.totalKwh24h > 0) {
                      const dev = metrics.deviationPct24h;
                      const isWarming =
                        metrics.isBaselineWarmingUp === true ||
                        (!Number.isFinite(dev as number) && metrics.expectedKwh24h !== null);

                      if (isWarming) {
                        const days = metrics.totalHistoryDays;
                        const daysLabel =
                          typeof days === "number" && days > 0
                            ? t("sitesList.trend.historyDaysLabel", {
                                defaultValue: " · ~{{days}}d history",
                                days,
                              })
                            : "";

                        pillClassName = "cei-pill cei-pill-neutral";
                        trendLabel = t("sitesList.trend.learningBaselineWithHistory", {
                          defaultValue: "Learning baseline (24h{{daysLabel}})",
                          daysLabel,
                        });
                      } else if (typeof dev === "number") {
                        const pct = `${Math.abs(dev).toFixed(1)}%`;

                        if (dev >= 10) {
                          pillClassName = "cei-pill cei-pill-negative";
                          trendLabel = t("sitesList.trend.aboveBaseline24h", {
                            defaultValue: "▲ {{pct}} above baseline (24h)",
                            pct,
                          });
                        } else if (dev > 2) {
                          pillClassName = "cei-pill cei-pill-warning";
                          trendLabel = t("sitesList.trend.aboveBaseline24h", {
                            defaultValue: "▲ {{pct}} above baseline (24h)",
                            pct,
                          });
                        } else if (dev <= -5) {
                          pillClassName = "cei-pill cei-pill-positive";
                          trendLabel = t("sitesList.trend.belowBaseline24h", {
                            defaultValue: "▼ {{pct}} below baseline (24h)",
                            pct,
                          });
                        } else if (dev < -1) {
                          pillClassName = "cei-pill cei-pill-positive";
                          trendLabel = t("sitesList.trend.belowBaseline24h", {
                            defaultValue: "▼ {{pct}} below baseline (24h)",
                            pct,
                          });
                        } else {
                          pillClassName = "cei-pill cei-pill-neutral";
                          trendLabel = t("sitesList.trend.nearBaseline24h", {
                            defaultValue: "● Near baseline (24h)",
                          });
                        }
                      } else {
                        pillClassName = "cei-pill cei-pill-neutral";
                        trendLabel = t("sitesList.trend.learningBaseline24h", {
                          defaultValue: "Learning baseline (24h)",
                        });
                      }
                    }

                    return (
                      <tr key={idStr}>
                        <td>
                          <Link
                            to={`/sites/${idStr}`}
                            style={{
                              fontSize: "0.85rem",
                              color: "var(--cei-text-accent)",
                              textDecoration: "none",
                            }}
                          >
                            <code>{idStr}</code>
                          </Link>
                        </td>
                        <td>
                          <Link
                            to={`/sites/${idStr}`}
                            style={{
                              fontSize: "0.9rem",
                              color: "#e5e7eb",
                              textDecoration: "none",
                            }}
                          >
                            {name}
                          </Link>
                        </td>
                        <td>{location}</td>
                        <td>
                          <span className={pillClassName} style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                            {trendLabel}
                          </span>
                        </td>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              gap: "0.4rem",
                              justifyContent: "flex-end",
                              flexWrap: "wrap",
                            }}
                          >
                            <Link
                              to={`/sites/${idStr}`}
                              className="cei-btn cei-btn-ghost"
                              style={{
                                fontSize: "0.8rem",
                                padding: "0.25rem 0.6rem",
                                textDecoration: "none",
                              }}
                            >
                              {t("sitesList.buttons.view", { defaultValue: "View" })}
                            </Link>

                            <button
                              type="button"
                              onClick={() => handleDeleteSite(site.id, site.name)}
                              className="cei-btn"
                              style={{
                                fontSize: "0.8rem",
                                padding: "0.25rem 0.6rem",
                                borderRadius: "999px",
                                border: "1px solid rgba(248, 113, 113, 0.8)",
                                color: "rgb(248, 113, 113)",
                                background:
                                  "radial-gradient(circle at top left, rgba(239, 68, 68, 0.12), rgba(15, 23, 42, 0.95))",
                              }}
                            >
                              {t("sitesList.buttons.delete", { defaultValue: "Delete" })}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default SitesList;
