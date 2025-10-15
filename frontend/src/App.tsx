import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./hooks/useAuth";
import Dashboard from "./pages/Dashboard";
import SiteList from "./pages/SiteList";
import SiteView from "./pages/SiteView";
import SiteEdit from "./pages/SiteEdit";
import Alerts from "./pages/Alerts";
import Account from "./pages/Account";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/sites" element={<SiteList />} />
          <Route path="/sites/create" element={<SiteEdit />} />
          <Route path="/sites/:id" element={<SiteView />} />
          <Route path="/sites/:id/edit" element={<SiteEdit />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/account" element={<Account />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;