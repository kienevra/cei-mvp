import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSites, deleteSite } from "../services/sites";
import { Site } from "../types/site";
import Table from "../components/Table";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import Modal from "../components/Modal";

export default function SitesList() {
  const { data: sites, isLoading, error } = useQuery<Site[], Error>({
    queryKey: ["sites"],
    queryFn: getSites,
  });

  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: deleteSite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setDeleteId(null);
    },
    onError: () => {
      setDeleteId(null);
    },
  });

  const handleDelete = (id: string) => setDeleteId(id);
  const confirmDelete = () => deleteId && mutation.mutate(deleteId);

  return (
    <div>
      <h1>Sites</h1>
      {isLoading && <LoadingSpinner />}
      {error && <ErrorBanner error={error} />}
      {sites && (
        <Table
          data={sites}
          columns={[
            { key: "name", label: "Name" },
            { key: "location", label: "Location" },
            { key: "status", label: "Status" },
            { key: "updatedAt", label: "Last Updated" },
            {
              key: "actions",
              label: "Actions",
              render: (site: Site) => (
                <>
                  <a href={`/sites/${site.id}`}>View</a>{" | "}
                  <a href={`/sites/${site.id}/edit`}>Edit</a>{" | "}
                  <button onClick={() => handleDelete(site.id)}>Delete</button>
                </>
              ),
            },
          ]}
        />
      )}
      <Modal
        open={!!deleteId}
        title="Confirm Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
        loading={mutation.isLoading}
      >
        Are you sure you want to delete this site?
      </Modal>
    </div>
  );
}