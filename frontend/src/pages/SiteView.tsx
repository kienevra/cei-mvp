import React, { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { getSite } from "../services/sites";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import PageHeader from "../components/PageHeader";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const SiteView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { data: site, loading, error } = useApi(() => getSite(id!));
  const [metrics, setMetrics] = React.useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (id) {
      fetch(`${import.meta.env.VITE_API_URL}/sites/${id}/metrics`)
        .then((r) => r.json())
        .then((d) => setMetrics(d.metrics || []))
        .catch(() => setMetrics([]));
    }
  }, [id]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner error={error} />;
  if (!site) return null;

  return (
    <div>
      <PageHeader title={site.name} />
      <div className="mb-4">
        <div className="text-gray-600">Location: {site.location}</div>
        <div className="text-gray-600">Status: {site.status}</div>
        <div className="text-gray-600">Last Updated: {site.updated_at}</div>
      </div>
      <div className="bg-white rounded shadow p-4 mb-6">
        <div className="font-semibold mb-2">Metrics</div>
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
        <div className="font-semibold mb-2">Raw Data</div>
        <pre className="bg-gray-100 rounded p-2 text-xs overflow-x-auto">{JSON.stringify(site, null, 2)}</pre>
      </div>
      <button className="mt-4 bg-gray-200 px-4 py-1 rounded" onClick={() => navigate(-1)}>
        Back
      </button>
    </div>
  );
};

export default SiteView;