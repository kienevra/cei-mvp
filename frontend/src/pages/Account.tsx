import React from "react";
import { useAuth } from "../hooks/useAuth";

const Account: React.FC = () => {
  const { token, logout } = useAuth();

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
          Account
        </h1>
        <p
          style={{
            marginTop: "0.3rem",
            fontSize: "0.85rem",
            color: "var(--cei-text-muted)",
          }}
        >
          Basic information about your CEI session. We’ll extend this with
          organization and role details later.
        </p>
      </section>

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
            Authentication
          </div>
          <div
            style={{
              marginTop: "0.45rem",
              fontSize: "0.9rem",
              fontWeight: 500,
            }}
          >
            Session token
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              fontSize: "0.8rem",
              color: "var(--cei-text-muted)",
              wordBreak: "break-all",
            }}
          >
            {token
              ? `cei_token is present in local storage (${token.slice(
                  0,
                  24
                )}…`
              : "No active token found. You may need to sign in again."}
          </div>
          <div style={{ marginTop: "0.8rem" }}>
            <button
              type="button"
              className="cei-btn cei-btn-ghost"
              onClick={logout}
            >
              Sign out
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Account;
