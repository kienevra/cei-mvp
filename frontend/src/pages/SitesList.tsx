// frontend/src/pages/SitesList.tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

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
        setError(
          e?.response?.data?.detail ||
            e?.message ||
            "Failed to load sites."
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
  }, []);

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setCreateError("Site name is required.");
      return;
    }
    setCreateError(null);
    setCreating(true);

    try {
      const payload = {
        name: newName.trim(),
        location: newLocation.trim() || undefined,
      };
      const created = await createSite(payload);

      setSites((prev) => [...prev, created as SiteRecord]);

      setNewName("");
      setNewLocation("");
    } catch (err: any) {
      setCreateError(
        err?.response?.data?.detail ||
          err?.message ||
          "Failed to create site."
      );
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
            Manage the plants, facilities, and lines you&apos;re monitoring.
            Sites are the anchor for dashboards, alerts, and reports.
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
              Go to CSV upload
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
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "0.4rem",
            }}
          >
            Add a site
          </div>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              marginBottom: "0.6rem",
            }}
          >
            Create sites for your organization so that uploaded meters and
            alerts can be anchored to real facilities.
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
                Site name *
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Lamborghini Bologna"
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
                Location (optional)
              </label>
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder="e.g. Bologna, IT"
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
              <button
                type="submit"
                className="cei-btn cei-btn-primary"
                disabled={creating}
              >
                {creating ? "Creating…" : "Add site"}
              </button>
            </div>
          </form>

          {createError && (
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.78rem",
                color: "#f97373",
              }}
            >
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
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Sites in your organization
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Click the site ID or name to open its dashboard. Upload CSVs
                keyed to <code>site-&lt;id&gt;</code> to drive trends, alerts,
                and reports.
              </div>
            </div>
          </div>

          {loading && (
            <div
              style={{
                padding: "1.2rem 0.5rem",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <LoadingSpinner />
            </div>
          )}

          {!loading && sites.length === 0 && (
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              No sites yet. Use the form above to create your first site, then
              upload timeseries data linked to <code>site-1</code>,{" "}
              <code>site-2</code>, etc.
            </div>
          )}

          {!loading && sites.length > 0 && (
            <div style={{ marginTop: "0.5rem", overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Site</th>
                    <th>Location</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => {
                    const idStr = String(site.id);
                    const name = site.name || `Site ${idStr}`;
                    const location = site.location || "—";

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
                          <Link
                            to={`/sites/${idStr}`}
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
