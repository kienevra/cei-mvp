import React from "react";

export const Card: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="bg-white rounded shadow p-4 flex flex-col items-center">
    <div className="text-2xl font-bold">{value}</div>
    <div className="text-gray-500 text-sm">{label}</div>
  </div>
);