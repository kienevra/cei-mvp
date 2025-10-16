import React from "react";
import { useApi } from "../hooks/useApi";
import Card from "../components/Card";
import Table from "../components/Table";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import { useQuery } from "@tanstack/react-query";
import { getSites } from "../services/sites";
import { Site } from "../types/site";
import { HealthIndicator } from "../components/HealthIndicator";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const { data: sites, isLoading: sitesLoading, error: sitesError } = useQuery<Site[], Error>({
    queryKey: ["sites"],
    queryFn: getSites,
  });

  const { data: health, isLoading: healthLoading, error: healthError } = useApi<{ status: string }>("/health");

  const metrics = [
    { label: "Sites", value: sites?.length ?? 0 },
    { label: "Active Alerts", value: 2 }, // TODO: call /alerts endpoint
    { label: "Weekly Savings", value: "$1,200" }, // TODO: call /metrics endpoint
  ];

  const chartData = [
    { name: "Mon", value: 120 },
    { name: "Tue", value: 210 },
    { name: "Wed", value: 180 },
    { name: "Thu", value: 260 },
    { name: "Fri", value: 300 },
    { name: "Sat", value: 200 },
    { name: "Sun", value: 150 },
  ];

  return (
    <div>
      <HealthIndicator status={health?.status} loading={healthLoading} error={healthError} />
      <div className="dashboard-cards">
        {metrics.map((m) => (
          <Card key={m.label} title={m.label} value={m.value} />
        ))}
      </div>
      <section>
        <h2>Weekly Metrics</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#2563eb" />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <section>
        <h2>Recent Alerts</h2>
        {sitesLoading ? <LoadingSpinner /> : sitesError ? <ErrorBanner error={sitesError} /> : <Table data={sites ?? []} />}
      </section>
    </div>
  );
}