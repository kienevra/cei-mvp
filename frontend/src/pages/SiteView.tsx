import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import TimeSeriesChart from '../components/TimeSeriesChart';

interface Opportunity {
  id: number;
  name: string;
  description: string;
  simple_roi_years: number;
  est_co2_tons_saved_per_year: number;
}

const SiteView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [metrics, setMetrics] = useState<any[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);

  useEffect(() => {
    api.get(`/api/v1/sites/${id}/metrics`).then(res => setMetrics(res.data.metrics || []));
    api.get(`/api/v1/sites/${id}/opportunities`).then(res => setOpportunities(res.data.opportunities || []));
  }, [id]);

  return (
    <div className="p-8">
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
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <SimulateIngestButton siteId={id} />
      </div>
    </div>
  );
};

const SimulateIngestButton: React.FC<{ siteId?: string }> = ({ siteId }) => {
  const handleClick = async () => {
    await api.post('/api/v1/ingest', {
      site_id: siteId,
      metrics: [
        { ts: new Date().toISOString(), value: Math.random() * 100 },
        { ts: new Date().toISOString(), value: Math.random() * 100 },
      ],
    });
    alert('Demo data ingested!');
  };
  return (
    <button className="bg-blue-500 text-white px-4 py-2 rounded" onClick={handleClick}>
      Simulate ingest
    </button>
  );
};

export default SiteView;
