// src/components/TimeSeriesChart.tsx
import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { MetricPoint } from '../types/metrics';

type Props = {
  data: MetricPoint[];
  label?: string;
  color?: string;
};

const TimeSeriesChart: React.FC<Props> = ({ data, label, color = '#16a34a' }) => (
  <div className="bg-white rounded shadow p-4">
    <div className="mb-2 font-semibold">{label}</div>
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="timestamp" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>
);

export default TimeSeriesChart;
