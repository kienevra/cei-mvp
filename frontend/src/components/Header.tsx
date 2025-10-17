// src/components/Header.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const Header: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  return (
    <header className="bg-white shadow flex items-center justify-between px-6 py-3">
      <Link to="/" className="text-xl font-bold text-green-700">CEI Platform</Link>
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
  );
};

export default Header;
