// frontend/src/App.tsx
import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
const Signup = lazy(() => import("./pages/Signup"));
const Account = lazy(() => import("./pages/Account"));
const Settings = lazy(() => import("./pages/Settings"));
const CSVUpload = lazy(() => import("./pages/CSVUpload"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Reports = lazy(() => import("./pages/Reports"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar: visibility controlled via .sidebar-shell in global.css */}
      <div className="sidebar-shell">
        <Sidebar />
      </div>

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
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Optional convenience alias */}
          <Route path="/join" element={<Navigate to="/signup" replace />} />

          {/* Protected app routes */}
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

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
