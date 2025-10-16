import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import TimeSeriesChart from '../components/TimeSeriesChart';
import { Opportunity, Metric, MetricsResponse, OpportunitiesResponse, ApiResponse } from '../types/api';

const SiteView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [metricsRes, opportunitiesRes] = await Promise.all([
          api.get<ApiResponse<MetricsResponse>>(`/api/v1/sites/${id}/metrics`),
          api.get<ApiResponse<OpportunitiesResponse>>(`/api/v1/sites/${id}/opportunities`)
        ]);
        setMetrics(metricsRes.data.data.metrics);
        setOpportunities(opportunitiesRes.data.data.opportunities);
      } catch (err) {
        console.error('Failed to fetch site data:', err);
        setError('Failed to load site data. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    if (id) {
      fetchData();
    }
  }, [id]);

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
          <Link to="/" className="block mt-2 text-blue-600 hover:underline">Return to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <Link to="/" className="text-blue-600 hover:underline mb-4 block">← Back to Dashboard</Link>
      <h1 className="text-2xl font-bold mb-4">Site Details</h1>
      <div className="mb-8">
        <TimeSeriesChart data={metrics} />
      </div>
      <h2 className="text-xl font-semibold mb-2">Opportunities</h2>
      <ul className="space-y-2">
        {opportunities.map(opp => (
          <li key={opp.id} className="bg-white rounded shadow p-4">
            <div className="font-bold">{opp.name}</div>
            <div>{opp.description}</div>
            <div>ROI: {opp.simple_roi_years.toFixed(2)} yrs</div>
            <div>CO₂ Saved: {opp.est_co2_tons_saved_per_year.toFixed(2)} t/year</div>
            <div>Annual Savings: {opp.est_annual_kwh_saved.toFixed(2)} kWh</div>
            <div>Investment: €{opp.est_capex_eur.toFixed(2)}</div>
          </li>
        ))}
      </ul>
      <div className="mt-8">
  <SimulateIngestButton siteId={id} onSuccess={() => handleFetchData()} />
      </div>
    </div>
  );
};


function handleFetchData() {
  // You may want to refetch site data here
  // For now, this is a placeholder
  window.location.reload();
}

const SimulateIngestButton: React.FC<{ siteId?: string; onSuccess?: () => void }> = ({ siteId, onSuccess }) => {
  const [isIngesting, setIsIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setIsIngesting(true);
    setError(null);
    try {
      await api.post('/api/v1/ingest', {
        site_id: siteId,
        metrics: [
          { ts: new Date().toISOString(), value: Math.random() * 100 },
          { ts: new Date().toISOString(), value: Math.random() * 100 },
        ],
      });
      onSuccess?.();
    } catch (err) {
      console.error('Failed to ingest data:', err);
      setError('Failed to ingest data. Please try again.');
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <div>
      <button 
        className={`bg-blue-500 text-white px-4 py-2 rounded ${isIngesting ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'}`} 
        onClick={handleClick}
        disabled={isIngesting}
      >
        {isIngesting ? 'Ingesting...' : 'Simulate ingest'}
      </button>
      {error && (
        <div className="mt-2 text-red-600">{error}</div>
      )}
    </div>
  );
};

export default SiteView;
