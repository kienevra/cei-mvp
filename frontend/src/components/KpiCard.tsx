// src/components/KpiCard.tsx
import React from 'react';

type KpiCardProps = {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  className?: string;
};

const KpiCard: React.FC<KpiCardProps> = ({ label, value, icon, className }) => (
  <div className={`bg-white rounded shadow p-4 flex items-center gap-4 ${className || ''}`}>
    {icon && <div className="text-3xl text-green-600">{icon}</div>}
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-gray-500 text-sm">{label}</div>
    </div>
  </div>
);

export default KpiCard;
