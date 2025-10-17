import React, { useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { Card } from "../components/Card";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import { useAuth } from "../hooks/useAuth";
import { getSites } from "../services/sites";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import PageHeader from "../components/PageHeader";

const Dashboard: React.FC = () => {
  const { data: health, loading: healthLoading, error: healthError } = useApi(() =>
    fetch(`${import.meta.env.VITE_API_URL}/health`).then((r) => r.json())
  );
  const { data: sites, loading: sitesLoading } = useApi(getSites);

  // Example: get metrics for first site (or fallback)
  const [metrics, setMetrics] = React.useState<any[]>([]);
  useEffect(() => {
    if (sites && sites.length > 0) {
      fetch(`${import.meta.env.VITE_API_URL}/sites/${sites[0].id}/metrics`)
        .then((r) => r.json())
        .then((d) => setMetrics(d.metrics || []))
        .catch(() => setMetrics([]));
    }
  }, [sites]);

  return (
    <div>
      <PageHeader title="Dashboard" />
      {healthLoading && <LoadingSpinner />}
      {healthError && <ErrorBanner error={healthError} />}
      {health && (
        <div className="mb-4">
          <span
            className={`inline-block w-3 h-3 rounded-full mr-2 ${health.status === "ok" ? "bg-green-500" : "bg-red-500"}`}
            aria-label={health.status === "ok" ? "Healthy" : "Unhealthy"}
          />
          <span className="text-sm">API Health: {health.status}</span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card label="Sites" value={sites?.length ?? "-"} />
        <Card label="Active Alerts" value="TODO" />
        <Card label="Weekly Savings" value="TODO" />
      </div>
      <div className="bg-white rounded shadow p-4 mb-6">
        <div className="font-semibold mb-2">Example Metrics</div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={metrics}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#16a34a" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div>
        <div className="font-semibold mb-2">Recent Events</div>
        {/* TODO: Replace with real events/alerts endpoint if available */}
        <div className="bg-white rounded shadow p-4 text-gray-500">No recent events.</div>
      </div>
    </div>
  );
};

export default Dashboard;