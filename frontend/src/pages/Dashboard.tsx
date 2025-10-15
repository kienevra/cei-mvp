import React from "react";
import { useSites } from "../hooks/useSites";
import { useMetricsAggregate } from "../hooks/useMetrics";
import KpiCard from "../components/KpiCard";
import TimeSeriesChart from "../components/TimeSeriesChart";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ErrorBanner from "../components/ErrorBanner";

const Dashboard: React.FC = () => {
  const { data: sites, isLoading: sitesLoading, error: sitesError } = useSites();
  const { data: metrics, isLoading: metricsLoading, error: metricsError } = useMetricsAggregate({ range: "30d" });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <KpiCard title="Total Sites" value={sites?.length ?? 0} loading={sitesLoading} />
        <KpiCard title="Avg Carbon Intensity" value={metrics?.avgCarbon ?? 0} loading={metricsLoading} />
        <KpiCard title="Recent Alerts" value={metrics?.alerts ?? 0} loading={metricsLoading} />
      </div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Carbon Intensity Trend</h2>
        {metricsLoading ? <LoadingSkeleton /> : metricsError ? <ErrorBanner error={metricsError} /> : <TimeSeriesChart data={metrics?.trend ?? []} />}
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-2">Sites</h2>
        {sitesLoading ? <LoadingSkeleton /> : sitesError ? <ErrorBanner error={sitesError} /> : (
          <ul>
            {sites?.map(site => (
              <li key={site.id} className="mb-2">
                <a href={`/sites/${site.id}`} className="text-blue-600 hover:underline">{site.name}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Dashboard;