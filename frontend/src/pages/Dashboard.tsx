import React, { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import KpiCard from "../components/KpiCard";
import TimeSeriesChart from "../components/TimeSeriesChart";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import { getSites } from "../services/api";

const Dashboard: React.FC = () => {
  const { accessToken } = useAuth();
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSites()
      .then((data) => setSites(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (!accessToken) {
    window.location.href = "/login";
    return null;
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      <div className="flex gap-4 mb-6">
        <KpiCard label="Total Sites" value={sites.length} />
        <KpiCard label="Avg. Efficiency" value="87%" />
        <KpiCard label="Outstanding Opps" value={3} />
      </div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Efficiency Over Time</h2>
        <TimeSeriesChart data={[{ timestamp: "2025-01-01", value: 120 }]} />
      </div>
      {loading && <LoadingSpinner />}
      <div className="bg-gray-100 p-4 rounded shadow text-gray-500 text-center">
        [Opportunities Table Placeholder]
      </div>
    </div>
  );
};

export default Dashboard;