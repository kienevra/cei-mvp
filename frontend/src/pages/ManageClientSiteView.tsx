// frontend/src/pages/ManageClientSiteView.tsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { setDelegatedOrg, clearDelegatedOrg } from "../services/api";
import SiteView from "./SiteView";

/**
 * Wraps SiteView with cross-org delegation.
 * Sets X-CEI-ORG-ID header so all API calls are scoped to the client org.
 * Clears the header on unmount so subsequent navigation is unaffected.
 * Uses a `ready` flag to prevent SiteView from mounting before the
 * delegation header is set — avoiding a race condition with API calls.
 */
const ManageClientSiteView: React.FC = () => {
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!orgId || !id) {
      navigate("/manage");
      return;
    }
    const numericOrgId = parseInt(orgId, 10);
    if (isNaN(numericOrgId)) {
      navigate("/manage");
      return;
    }
    setDelegatedOrg(numericOrgId);
    setReady(true);
    return () => {
      clearDelegatedOrg();
    };
  }, [orgId, id, navigate]);

  if (!ready || !orgId || !id) return null;

  return <SiteView />;
};

export default ManageClientSiteView;