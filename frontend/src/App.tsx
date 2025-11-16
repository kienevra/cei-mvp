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
const Account = lazy(() => import("./pages/Account"));
const Settings = lazy(() => import("./pages/Settings"));
const CSVUpload = lazy(() => import("./pages/CSVUpload"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopNav />
        <main className="p-4">{children}</main>
      </div>
    </div>
  );
}

const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Root: redirect to /dashboard after login */}
          <Route
            path="/"
            element={<Navigate to="/dashboard" replace />}
          />

          {/* Dashboard */}
          <Route
            path="/dashboard"
            element={
              <Layout>
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* Sites */}
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

          {/* Upload */}
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

          {/* Account / Settings (optional now, but wired) */}
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

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
