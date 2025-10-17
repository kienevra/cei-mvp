import React, { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

const Login: React.FC = () => {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(form);
    } catch (err: any) {
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-24 bg-white rounded shadow p-6">
      <h1 className="text-xl font-bold mb-4">Sign in to CEI</h1>
      {error && <ErrorBanner error={error} />}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          name="username"
          type="text"
          placeholder="Username"
          className="border rounded px-2 py-1"
          value={form.username}
          onChange={handleChange}
          required
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          className="border rounded px-2 py-1"
          value={form.password}
          onChange={handleChange}
          required
        />
        <button className="bg-green-600 text-white px-4 py-2 rounded mt-2" type="submit" disabled={loading}>
          {loading ? <LoadingSpinner small /> : "Login"}
        </button>
      </form>
    </div>
  );
};

export default Login;