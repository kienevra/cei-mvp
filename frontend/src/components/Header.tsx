// src/components/Header.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

const Header: React.FC<HeaderProps> = ({ title, subtitle }) => {
  const { isAuthenticated, logout } = useAuth();
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      {subtitle && <div className="text-gray-500">{subtitle}</div>}
      <header className="bg-white shadow flex items-center justify-between px-6 py-3">
        <nav className="flex items-center gap-4">
          <Link to="/dashboard" className="hover:underline">Dashboard</Link>
          <Link to="/sites" className="hover:underline">Sites</Link>
          <Link to="/alerts" className="hover:underline">Alerts</Link>
          <Link to="/settings" className="hover:underline">Settings</Link>
          {isAuthenticated && (
            <button onClick={logout} className="ml-4 px-3 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">Logout</button>
          )}
        </nav>
      </header>
    </div>
  );
};

export default Header;
