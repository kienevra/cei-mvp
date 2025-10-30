// src/components/KpiCard.tsx
import React from 'react';

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, icon }) => (
  <div className="bg-white shadow rounded p-4 flex items-center gap-3">
    {icon}
    <div>
      <div className="text-gray-500">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  </div>
);

export default KpiCard;
