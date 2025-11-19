// frontend/src/pages/Account.tsx
import React, { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { deleteAccount } from "../services/api";

const Account: React.FC = () => {
  const { logout } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      "This will permanently delete your account and log you out. Continue?"
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);

    try {
      await deleteAccount();
      // After backend deletion, clear local auth and send user to login
      logout();
    } catch (e: any) {
      setError(e?.message || "Failed to delete account.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="dashboard-page">
      <section>
        <div className="cei-card">
          <h1
            style={{
              fontSize: "1.3rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              marginBottom: "0.4rem",
            }}
          >
            Account
          </h1>
          <p
            style={{
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Manage your CEI account. Deleting your account is irreversible in
            this MVP.
          </p>
        </div>
      </section>

      <section>
        <div className="cei-card">
          <div
            style={{
              marginBottom: "0.6rem",
            }}
          >
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Delete account
            </div>
            <div
              style={{
                marginTop: "0.2rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              This will permanently remove your user record and associated
              subscriptions. You will be logged out.
            </div>
          </div>

          {error && (
            <div
              style={{
                marginBottom: "0.5rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-danger)",
              }}
            >
              {error}
            </div>
          )}

          <div className="account-danger-actions">
            <button
              type="button"
              className="cei-btn cei-btn-danger"
              onClick={handleDeleteAccount}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Account;
