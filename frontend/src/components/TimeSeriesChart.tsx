// src/components/TimeSeriesChart.tsx
import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface TimeSeriesChartProps {
  data: Array<{ timestamp: string | number; value: number }>;
  height?: number;
}

const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({ data, height = 300 }) => {
  if (!data || data.length === 0) {
    return <div className="text-gray-500 text-center p-8">No data available</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(tick) =>
            typeof tick === 'string' ? tick.slice(5) : tick
          }
        />
        <YAxis allowDecimals={false} />
        <Tooltip
          labelFormatter={(label) => `Date: ${label}`}
          formatter={(value: number) => [`${value}`, 'Value']}
        />
        <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default TimeSeriesChart;
