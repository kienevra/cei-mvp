import React from "react";

export default function PageHeader({ title }: { title: string }) {
  return <h1 className="page-header">{title}</h1>;
}