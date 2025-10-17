import React from "react";
import { Link } from "react-router-dom";

const NotFound: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-[60vh]">
    <h1 className="text-3xl font-bold mb-2">404</h1>
    <div className="mb-4">Page not found.</div>
    <Link to="/" className="text-green-700 underline">
      Go Home
    </Link>
  </div>
);

export default NotFound;