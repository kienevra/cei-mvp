import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const Sidebar: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const links = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/sites", label: "Sites" },
    { to: "/account", label: "Account" },
    { to: "/settings", label: "Settings" },
  ];
  return (
    <aside className="hidden md:flex flex-col w-48 bg-white border-r min-h-screen">
      <div className="p-4 font-bold text-green-700 text-lg">CEI</div>
      <nav className="flex-1 flex flex-col gap-2 px-2">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className={`rounded px-3 py-2 ${pathname.startsWith(l.to) ? "bg-green-100 text-green-700" : "hover:bg-gray-100"}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      {isAuthenticated && (
        <div className="p-2 text-xs text-gray-400">Logged in</div>
      )}
    </aside>
  );
};

export default Sidebar;