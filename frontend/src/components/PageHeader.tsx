import React from "react";

const PageHeader: React.FC<{ title: string }> = ({ title }) => (
  <h1 className="text-2xl font-bold mb-4">{title}</h1>
);

export default PageHeader;