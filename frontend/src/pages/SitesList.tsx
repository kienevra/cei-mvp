import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSites, createSite } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type SiteRecord = {
  id: number | string;
  name: string;
  location?: string | null;
  created_at?: string | null;
  [key: string]: any;
};

const SitesList: React.FC = () => {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const navigate = useNavigate();

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
      } catch (e: any) {
        if (!isMounted) return;
        const msg =
          e?.response?.data?.detail ||
          e?.response?.data?.error ||
          e?.message ||
          "Failed to load sites.";
        setError(msg);
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    loadSites();

    return () => {
      isMounted = false;
    };
  }, []);

  const resetCreateForm = () => {
    setNewName("");
    setNewLocation("");
    setCreateError(null);
    setCreating(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!newName.trim()) {
      setCreateError("Site name is required.");
      return;
    }

    setCreating(true);

    try {
      const created = (await createSite({
        name: newName.trim(),
        location: newLocation.trim() || undefined,
      })) as SiteRecord;

      setSites((prev) => [...prev, created]);
      resetCreateForm();
      setShowCreate(false);
    } catch (e: any) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to create site.";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const hasSites = sites.length > 0;

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
            Sites
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Your monitored plants, facilities, and assets. Each site can ingest
            timeseries data and feed into CEI analytics.
          </p>
        </div>
        <div>
          <button
            type="button"
            className="cei-btn cei-btn-primary"
            onClick={() => {
              setShowCreate((prev) => !prev);
              setCreateError(null);
            }}
          >
            {showCreate ? "Cancel" : "+ Add site"}
          </button>
        </div>
      </section>

      {/* Summary card */}
      <section className="dashboard-row">
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cei-text-muted)",
            }}
          >
            Total sites
          </div>
          <div
            style={{
              marginTop: "0.4rem",
              fontSize: "1.5rem",
              fontWeight: 600,
            }}
          >
            {sites.length}
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            {sites.length === 0
              ? "No sites configured yet."
              : "Sites currently configured for energy and CO₂ monitoring."}
          </div>
        </div>
      </section>

      {/* Main list card */}
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
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Sites overview
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Registry of all monitored sites. Use this as the anchor for
                per-site dashboards and analytics.
              </div>
            </div>
          </div>

          {error && (
            <div style={{ marginBottom: "0.75rem" }}>
              <ErrorBanner message={error} onClose={() => setError(null)} />
            </div>
          )}

          {/* Create form */}
          {showCreate && (
            <div
              style={{
                marginBottom: "0.9rem",
                borderRadius: "0.9rem",
                border: "1px solid rgba(148, 163, 184, 0.4)",
                padding: "0.8rem 0.9rem",
                background:
                  "radial-gradient(circle at top left, rgba(56, 189, 248, 0.14), rgba(15, 23, 42, 0.95))",
              }}
            >
              <form onSubmit={handleCreate}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 2fr) auto",
                    gap: "0.6rem",
                    alignItems: "flex-end",
                  }}
                >
                  <div>
                    <label htmlFor="siteName">Site name</label>
                    <input
                      id="siteName"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Lamborghini – Sant’Agata"
                    />
                  </div>
                  <div>
                    <label htmlFor="siteLocation">Location</label>
                    <input
                      id="siteLocation"
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                      placeholder="City / region"
                    />
                  </div>
                  <div>
                    <button
                      type="submit"
                      className="cei-btn cei-btn-primary"
                      disabled={creating}
                    >
                      {creating ? "Creating…" : "Save"}
                    </button>
                  </div>
                </div>
                {createError && (
                  <div
                    style={{
                      marginTop: "0.4rem",
                      fontSize: "0.78rem",
                      color: "var(--cei-text-danger)",
                    }}
                  >
                    {createError}
                  </div>
                )}
              </form>
            </div>
          )}

          {/* Table / loading / empty state */}
          {loading ? (
            <div
              style={{
                padding: "1.2rem 0.5rem",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <LoadingSpinner />
            </div>
          ) : !hasSites ? (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
                paddingTop: "0.5rem",
              }}
            >
              No sites configured yet. Use the <strong>“Add site”</strong> action
              above to register your first facility.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Location</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => (
                    <tr
                      key={site.id}
                      onClick={() => navigate(`/sites/${site.id}`)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{site.id}</td>
                      <td>{site.name}</td>
                      <td>{site.location || "—"}</td>
                      <td
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Link
                          to={`/sites/${site.id}`}
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--cei-text-accent)",
                            textDecoration: "none",
                          }}
                        >
                          View site →
                        </Link>
                      </td>
                    </tr>
                  ))}
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
