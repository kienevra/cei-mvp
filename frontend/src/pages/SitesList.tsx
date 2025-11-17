import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSites, createSite } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type SiteRecord = {
  id: number | string;
  name: string;
  location?: string | null;
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
    setLoading(true);
    setError(null);

    getSites()
      .then((data) => {
        if (!isMounted) return;
        const normalized = Array.isArray(data) ? data : [];
        setSites(normalized as SiteRecord[]);
      })
      .catch((e: any) => {
        if (!isMounted) return;
        setError(e?.message || "Failed to load sites.");
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const hasSites = sites && sites.length > 0;

  const resetCreateForm = () => {
    setNewName("");
    setNewLocation("");
    setCreateError(null);
    setCreating(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setCreateError("Site name is required.");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const created = await createSite({
        name: newName.trim(),
        location: newLocation.trim() || undefined,
      });

      setSites((prev) => [...prev, created]);
      resetCreateForm();
      setShowCreate(false);
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create site.");
    } finally {
      setCreating(false);
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
            Sites
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Your monitored plants, facilities, and sites participating in CEI
            analytics.
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
              : "Sites currently tracked for energy and CO₂ performance."}
          </div>
        </div>
      </section>

      {/* Main content card: create form + table / empty / loading / error */}
      <section>
        <div className="cei-card">
          <div
            style={{
              marginBottom: "0.6rem",
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
                Basic registry of each monitored site. We’ll layer analytics and
                drill-down views on top of this.
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
                      placeholder="e.g. Turin Plant A"
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

          {/* Table / empty / loading */}
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
          ) : hasSites ? (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => (
                    <tr
                      key={site.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate(`/sites/${site.id}`)}
                    >
                      <td>{site.id}</td>
                      <td>{site.name}</td>
                      <td>{site.location || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                padding: "1rem 0.2rem 0.3rem",
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              <p>
                No sites are configured yet. Once sites are onboarded, you’ll
                see them listed here with basic metadata and can drill into
                per-site dashboards.
              </p>
              <p style={{ marginTop: "0.4rem" }}>
                Use the <strong>“Add site”</strong> action above to register
                your first plant or facility.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default SitesList;
