import React, { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import FormField from "../components/FormField";
import ErrorBanner from "../components/ErrorBanner";
import LoadingSpinner from "../components/LoadingSpinner";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
      navigate("/");
    } catch (err: any) {
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <h1>Login</h1>
      <FormField label="Username" value={username} onChange={setUsername} required />
      <FormField label="Password" type="password" value={password} onChange={setPassword} required />
      {error && <ErrorBanner error={error} />}
      <button type="submit" disabled={loading}>
        {loading ? <LoadingSpinner /> : "Login"}
      </button>
    </form>
  );
}