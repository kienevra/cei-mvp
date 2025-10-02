import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DataPoint {
  ts: string;
  value: number;
}

interface TimeSeriesChartProps {
  data: DataPoint[];
}

const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({ data }) => (
  <ResponsiveContainer width="100%" height={300}>
    <LineChart data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="ts" />
      <YAxis />
      <Tooltip />
      <Line type="monotone" dataKey="value" stroke="#8884d8" dot={false} />
    </LineChart>
  </ResponsiveContainer>
);

export default TimeSeriesChart;
