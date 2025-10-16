import React from "react";
import { Link } from "react-router-dom";

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <Link to="/">Dashboard</Link>
      <Link to="/sites">Sites</Link>
      <Link to="/account">Account</Link>
      <Link to="/settings">Settings</Link>
    </aside>
  );
}