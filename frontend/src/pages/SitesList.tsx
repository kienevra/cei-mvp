import React, { useState, useMemo } from "react";
import { useApi } from "../hooks/useApi";
import { getSites, deleteSite } from "../services/sites";
import Table from "../components/Table";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import PageHeader from "../components/PageHeader";
import Modal from "../components/Modal";
import { useNavigate } from "react-router-dom";
import { Site } from "../types/Site";

const columns = [
  { key: "name", label: "Name" },
  { key: "location", label: "Location" },
  { key: "status", label: "Status" },
  { key: "updated_at", label: "Last Updated" },
  { key: "actions", label: "Actions" },
];

const SitesList: React.FC = () => {
  const { data: sites, loading, error, refetch } = useApi(getSites);
  const [search, setSearch] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const navigate = useNavigate();

  const filtered = useMemo(
    () =>
      (sites || []).filter(
        (s: Site) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          (s.location || "").toLowerCase().includes(search.toLowerCase())
      ),
    [sites, search]
  );

  const handleDelete = async (id: string) => {
    setConfirmId(null);
    const prev = sites;
    try {
      await deleteSite(id);
      refetch();
    } catch (e) {
      alert("Delete failed. Rolling back.");
      refetch();
    }
  };

  return (
    <div>
      <PageHeader title="Sites" />
      <div className="mb-4 flex flex-col sm:flex-row gap-2 items-center">
        <input
          className="border rounded px-2 py-1"
          placeholder="Search sites..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="ml-auto bg-green-600 text-white px-4 py-1 rounded" onClick={() => navigate("/sites/new")}>
          + New Site
        </button>
      </div>
      {loading && <LoadingSpinner />}
      {error && <ErrorBanner error={error} />}
      <Table
        columns={columns}
        data={filtered.map((site: Site) => ({
          ...site,
          actions: (
            <div className="flex gap-2">
              <button className="text-blue-600" onClick={() => navigate(`/sites/${site.id}`)}>
                View
              </button>
              <button className="text-yellow-600" onClick={() => navigate(`/sites/${site.id}/edit`)}>
                Edit
              </button>
              <button className="text-red-600" onClick={() => setConfirmId(site.id)}>
                Delete
              </button>
            </div>
          ),
        }))}
      />
      <Modal open={!!confirmId} onClose={() => setConfirmId(null)} title="Confirm Delete">
        <div>Are you sure you want to delete this site?</div>
        <div className="mt-4 flex gap-2">
          <button className="bg-red-600 text-white px-4 py-1 rounded" onClick={() => confirmId && handleDelete(confirmId)}>
            Delete
          </button>
          <button className="bg-gray-200 px-4 py-1 rounded" onClick={() => setConfirmId(null)}>
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default SitesList;