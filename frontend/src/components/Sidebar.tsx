import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FiHome,
  FiList,
  FiBell,
  FiBarChart2,
  FiUser,
  FiSettings,
} from "react-icons/fi";

/**
 * Sidebar navigation for CEI app.
 * Only high-frequency / long-term flows live here.
 */
const navItems = [
  { label: "Dashboard", path: "/", icon: <FiHome /> },
  { label: "Sites", path: "/sites", icon: <FiList /> },
  { label: "Alerts", path: "/alerts", icon: <FiBell /> },
  { label: "Reports", path: "/reports", icon: <FiBarChart2 /> },
  { label: "Account", path: "/account", icon: <FiUser /> },
  { label: "Settings", path: "/settings", icon: <FiSettings /> },
];

const Sidebar: React.FC = () => {
  const { pathname } = useLocation();

  return (
    <aside className="w-48 bg-gray-900 text-white h-screen flex flex-col">
      <div className="p-4 font-bold text-lg tracking-tight">CEI</div>
      <nav className="flex-1">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.path;
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`flex items-center px-6 py-2 rounded transition-colors hover:bg-gray-800 ${
                    active ? "bg-gray-800" : ""
                  }`}
                >
                  <span className="mr-3">{item.icon}</span>
                  <span className="text-sm">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
};

export default Sidebar;
