import React from "react";
import { Link, useLocation } from "react-router-dom";
import { FiHome, FiList, FiUser, FiSettings } from "react-icons/fi";

/**
 * Sidebar navigation for CEI app.
 */
const navItems = [
  { label: 'Dashboard', path: '/', icon: <FiHome /> },
  { label: 'Sites', path: '/sites', icon: <FiList /> },
  { label: 'Account', path: '/account', icon: <FiUser /> },
  { label: 'Settings', path: '/settings', icon: <FiSettings /> },
];

const Sidebar: React.FC = () => {
  const { pathname } = useLocation();
  return (
    <aside className="w-48 bg-gray-900 text-white h-screen flex flex-col">
      <div className="p-4 font-bold text-lg">CEI</div>
      <nav className="flex-1">
          {navItems.map(item => (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`flex items-center px-6 py-2 rounded transition-colors hover:bg-gray-800 ${pathname === item.path ? 'bg-gray-800' : ''}`}
              >
                <span className="mr-3">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          ))}
      </nav>
    </aside>
  );
};

export default Sidebar;