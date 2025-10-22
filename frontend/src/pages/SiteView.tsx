import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSite } from '../services/sites';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBanner from '../components/ErrorBanner';

const SiteView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [site, setSite] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchSite(id)
      .then(data => setSite(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Site Details</h1>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {loading ? <LoadingSpinner /> : (
        <div>
          {site ? (
            <div>
              <div><strong>ID:</strong> {site.id}</div>
              <div><strong>Name:</strong> {site.name}</div>
              <div><strong>Location:</strong> {site.location}</div>
              {/* Add more fields as needed */}
            </div>
          ) : <div>No site found.</div>}
        </div>
      )}
    </div>
  );
};

export default SiteView;