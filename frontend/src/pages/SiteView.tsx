import React from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSite } from "../services/sites";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import Card from "../components/Card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Site } from "../types/site";

export default function SiteView() {
  const { id } = useParams<{ id: string }>();
  const { data: site, isLoading, error } = useQuery<Site, Error>({
    queryKey: ["site", id],
    queryFn: () => getSite(id!),
    enabled: !!id,
  });

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
      {isLoading && <LoadingSpinner />}
      {error && <ErrorBanner error={error} />}
      {site && (
        <>
          <Card title={site.name} value={site.location ?? "Unknown location"} />
          <section>
            <h2>Metrics</h2>
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
            <h2>Raw Data</h2>
            <pre>{JSON.stringify(site, null, 2)}</pre>
          </section>
        </>
      )}
    </div>
  );
}