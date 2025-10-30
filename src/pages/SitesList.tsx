import React, { useEffect, useState } from "react";
import { fetchSites } from "../services/sites";
import Table from "../components/Table";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";

const columns = ["id", "name", "location"];

const SitesList: React.FC = () => {
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchSites()
      .then((data) => setSites(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Sites</h1>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {loading ? <LoadingSpinner /> : <Table columns={columns} data={sites} />}
    </div>
  );
};

export default SitesList;