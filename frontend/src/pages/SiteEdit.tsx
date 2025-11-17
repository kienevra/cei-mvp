import React from "react";
import { useParams } from "react-router-dom";

const SiteEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="dashboard-page">
      <section>
        <h1
          style={{
            fontSize: "1.3rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Edit site
        </h1>
        <p
          style={{
            marginTop: "0.3rem",
            fontSize: "0.85rem",
            color: "var(--cei-text-muted)",
          }}
        >
          Update metadata for site {id}. We’ll add full editing capabilities
          once the backend contract is finalized.
        </p>
      </section>

      <section>
        <div className="cei-card">
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Site editing is not implemented yet. This screen is reserved for a
            future workflow where you can adjust site names, locations, and
            tagging.
          </div>
        </div>
      </section>
    </div>
  );
};

export default SiteEdit;
