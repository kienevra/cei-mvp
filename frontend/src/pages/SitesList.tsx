// frontend/src/pages/SitesList.tsx
import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getSites } from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

type SiteRecord = {
  id: number | string;
  name: string;
  location?: string | null;
  [key: string]: any;
};

const SitesList: React.FC = () => {
  const navigate = useNavigate();

  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSites() {
      setLoading(true);
      setError(null);

      try {
        const data = await getSites();
        if (!isMounted) return;

        if (Array.isArray(data)) {
          setSites(data as SiteRecord[]);
        } else {
          setSites([]);
        }
      } catch (e: any) {
        if (!isMounted) return;
        setError(e?.message || "Failed to load sites.");
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

  const hasSites = sites.length > 0;

  const handleRowClick = (siteId: number | string) => {
    navigate(`/sites/${siteId}`);
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
            Portfolio of monitored sites. Drill down to see per-site trends and
            upload data tied to each location.
          </p>
        </div>
        <div
          style={{
            textAlign: "right",
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
          }}
        >
          {hasSites ? (
            <div>
              Tracking <strong>{sites.length}</strong> site
              {sites.length === 1 ? "" : "s"}.
            </div>
          ) : (
            <div>No sites detected yet.</div>
          )}
          <div>
            Need to ingest data?{" "}
            <Link to="/upload" className="cei-btn cei-btn-primary">
              Go to upload
            </Link>
          </div>
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
                Site directory
              </div>
              <div
                style={{
                  marginTop: "0.2rem",
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                Click a site to open its dedicated dashboard. From there, you
                can review trends and push new CSV data into CEI.
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

          {!loading && !hasSites && !error && (
            <div
              style={{
                paddingTop: "0.5rem",
                paddingBottom: "0.5rem",
                fontSize: "0.85rem",
                color: "var(--cei-text-muted)",
              }}
            >
              <p>
                No sites have been registered or inferred yet. CEI creates
                site-level views once it sees data with a{" "}
                <code>site_id</code> column.
              </p>
              <p style={{ marginTop: "0.5rem" }}>
                Start by{" "}
                <Link to="/upload" style={{ color: "var(--cei-text-accent)" }}>
                  uploading a CSV
                </Link>{" "}
                that includes <code>site_id</code>, <code>ts</code>, and{" "}
                <code>value</code> fields. Then refresh this page.
              </p>
            </div>
          )}

          {!loading && hasSites && (
            <div style={{ marginTop: "0.4rem", overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="hide-on-mobile">Location</th>
                    <th className="hide-on-mobile">Internal ID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => {
                    const idStr = String(site.id);
                    return (
                      <tr
                        key={idStr}
                        className="clickable-row"
                        onClick={() => handleRowClick(site.id)}
                      >
                        <td>{site.name || `Site ${idStr}`}</td>
                        <td className="hide-on-mobile">
                          {site.location || "—"}
                        </td>
                        <td className="hide-on-mobile">{idStr}</td>
                        <td
                          onClick={(e) => {
                            // prevent row click when pressing the button
                            e.stopPropagation();
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: "0.4rem",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              className="cei-btn cei-btn-ghost"
                              onClick={() => navigate(`/sites/${site.id}`)}
                            >
                              Open
                            </button>
                            <Link to="/upload">
                              <button className="cei-btn cei-btn-primary">
                                Upload data
                              </button>
                            </Link>
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
