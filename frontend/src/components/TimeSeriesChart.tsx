import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Metric } from '../types/api';

interface TimeSeriesChartProps {
  data: Metric[];
}

const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({ data }) => {
  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis 
          dataKey="ts" 
          tickFormatter={formatDate}
          label={{ value: 'Time', position: 'bottom' }}
        />
        <YAxis 
          label={{ value: 'Value (kW)', angle: -90, position: 'left' }}
        />
                 <Tooltip 
                   labelFormatter={(label: string | number) => formatDate(String(label))}
                   formatter={(value: string | number | (string | number)[], name: string, props: any) => {
                     let displayValue = value;
                     if (Array.isArray(value)) {
                       displayValue = value.join(', ');
                     }
                     if (typeof displayValue === 'number') {
                       displayValue = displayValue.toLocaleString();
                     }
                     return [`${displayValue} kW`, name];
                   }}
                 />
        <Line 
          type="monotone" 
          dataKey="value" 
          stroke="#8884d8" 
          dot={false}
          name="Power"
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default TimeSeriesChart;
