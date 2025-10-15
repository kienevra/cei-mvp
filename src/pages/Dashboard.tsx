import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Site, SitesResponse, ApiResponse } from '../types/api';

const Dashboard: React.FC = () => {
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSites = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.get<ApiResponse<SitesResponse>>('/api/v1/sites');
        setSites(response.data.data.sites);
      } catch (err) {
        console.error('Failed to fetch sites:', err);
        setError('Failed to load sites. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSites();
  }, []);

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center items-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Sites Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sites.map(site => (
          <Link to={`/sites/${site.id}`} key={site.id} className="block">
            <div className="bg-white rounded shadow p-4 hover:shadow-lg transition-shadow duration-200">
              <h2 className="text-xl font-semibold mb-2">{site.name}</h2>
              <div className="space-y-1">
                <div>Energy (kWh): {site.kpis.energy_kwh.toFixed(2)}</div>
                <div>Avg Power (kW): {site.kpis.avg_power_kw.toFixed(2)}</div>
                <div>Peak (kW): {site.kpis.peak_kw.toFixed(2)}</div>
                <div>Load Factor: {site.kpis.load_factor.toFixed(2)}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
