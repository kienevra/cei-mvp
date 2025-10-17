import React from "react";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";

const Account: React.FC = () => {
  const { token } = useAuth();
  // TODO: Fetch user info if available
  return (
    <div>
      <PageHeader title="Account" />
      <div className="bg-white rounded shadow p-4">
        <div className="mb-2">Token:</div>
        <pre className="bg-gray-100 rounded p-2 text-xs overflow-x-auto">{token}</pre>
      </div>
    </div>
  );
};

export default Account;