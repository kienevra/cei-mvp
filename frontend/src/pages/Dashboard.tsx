import React, { useEffect, useState } from 'react';
import api from '../services/api';

interface Site {
  id: number;
  name: string;
  kpis: {
    energy_kwh: number;
    avg_power_kw: number;
    peak_kw: number;
    load_factor: number;
  };
}

const Dashboard: React.FC = () => {
  const [sites, setSites] = useState<Site[]>([]);

  useEffect(() => {
    // Fetch sites and KPIs from API
    api.get('/api/v1/sites').then(res => setSites(res.data.sites || []));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Sites Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sites.map(site => (
          <div key={site.id} className="bg-white rounded shadow p-4">
            <h2 className="text-xl font-semibold mb-2">{site.name}</h2>
            <div className="space-y-1">
              <div>Energy (kWh): {site.kpis.energy_kwh}</div>
              <div>Avg Power (kW): {site.kpis.avg_power_kw}</div>
              <div>Peak (kW): {site.kpis.peak_kw}</div>
              <div>Load Factor: {site.kpis.load_factor}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
