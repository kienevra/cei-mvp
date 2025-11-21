// frontend/src/App.tsx
import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import ProtectedRoute from "./components/ProtectedRoute";
import LoadingSpinner from "./components/LoadingSpinner";
import "./styles/global.css";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const SitesList = lazy(() => import("./pages/SitesList"));
const SiteView = lazy(() => import("./pages/SiteView"));
const Login = lazy(() => import("./pages/Login"));
const Account = lazy(() => import("./pages/Account"));
const Settings = lazy(() => import("./pages/Settings"));
const CSVUpload = lazy(() => import("./pages/CSVUpload"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Reports = lazy(() => import("./pages/Reports"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopNav />
        <main>{children}</main>
      </div>
    </div>
  );
}

const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          {/* Public route */}
          <Route path="/login" element={<Login />} />

          {/* Dashboard */}
          <Route
            path="/"
            element={
              <Layout>
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* Sites list */}
          <Route
            path="/sites"
            element={
              <Layout>
                <ProtectedRoute>
                  <SitesList />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* Single site view */}
          <Route
            path="/sites/:id"
            element={
              <Layout>
                <ProtectedRoute>
                  <SiteView />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* Alerts – FIXED (no nested route wrapper) */}
          <Route
            path="/alerts"
            element={
              <Layout>
                <ProtectedRoute>
                  <Alerts />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* Reports */}
          <Route
            path="/reports"
            element={
              <Layout>
                <ProtectedRoute>
                  <Reports />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* CSV Upload */}
          <Route
            path="/upload"
            element={
              <Layout>
                <ProtectedRoute>
                  <CSVUpload />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* Account */}
          <Route
            path="/account"
            element={
              <Layout>
                <ProtectedRoute>
                  <Account />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* Settings */}
          <Route
            path="/settings"
            element={
              <Layout>
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* 404 – can leave without Layout if you want a bare page */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
