import React, { useEffect, useState } from "react";
import TimeSeriesChart from "../components/TimeSeriesChart";
import { getSites } from "../services/api";
import { useAuth } from "../hooks/useAuth";

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [sites, setSites] = useState<any[]>([]);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    getSites()
      .then((d) => setSites(d?.sites || []))
      .catch(() => setSites([]))
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  const sampleData = [
    { timestamp: "2025-10-01T00:00:00Z", value: 10 },
    { timestamp: "2025-10-01T01:00:00Z", value: 12 },
    { timestamp: "2025-10-01T02:00:00Z", value: 8 },
  ];

  return (
    <div style={{ padding: 20 }}>
      <h1>Dashboard</h1>
      {loading ? <div>Loading...</div> : <div>Sites: {sites.length}</div>}
      <div style={{ marginTop: 20 }}>
        <h2>Sample Timeseries</h2>
        <TimeSeriesChart data={sampleData} />
      </div>
    </div>
  );
}