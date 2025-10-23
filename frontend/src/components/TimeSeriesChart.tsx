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
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
  );
};

export default TimeSeriesChart;
