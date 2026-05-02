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
const Account = lazy(() => import("./pages/Account"));
const Settings = lazy(() => import("./pages/Settings"));
const CSVUpload = lazy(() => import("./pages/CSVUpload"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Reports = lazy(() => import("./pages/Reports"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ManageDashboard = lazy(() => import("./pages/ManageDashboard"));
const ManageClientOrg = lazy(() => import("./pages/ManageClientOrg"));
const ManageClientSiteView = lazy(() => import("./pages/ManageClientSiteView"));


function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
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
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Protected app routes â€” accessible to all org types */}
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

          {/* Managing org only */}
          <Route
            path="/manage"
            element={
              <Layout>
                <ProtectedRoute allowedOrgTypes={["managing"]}>
                  <ManageDashboard />
                </ProtectedRoute>
              </Layout>
            }
          />

          <Route
            path="/manage/client-orgs/:id"
            element={
              <Layout>
                <ProtectedRoute allowedOrgTypes={["managing"]}>
                  <ManageClientOrg />
                </ProtectedRoute>
              </Layout>
            }
          />

          <Route
            path="/manage/client-orgs/:orgId/sites/:id"
            element={
              <Layout>
                <ProtectedRoute allowedOrgTypes={["managing"]}>
                  <ManageClientSiteView />
                </ProtectedRoute>
              </Layout>
            }
          />

          {/* Standalone org only */}
          <Route
            path="/sites"
            element={
              <Layout>
                <ProtectedRoute allowedOrgTypes={["standalone"]}>
                  <SitesList />
                </ProtectedRoute>
              </Layout>
            }
          />

          <Route
            path="/sites/:id"
            element={
              <Layout>
                <ProtectedRoute allowedOrgTypes={["standalone"]}>
                  <SiteView />
                </ProtectedRoute>
              </Layout>
            }
          />

          <Route
            path="/alerts"
            element={
              <Layout>
                <ProtectedRoute allowedOrgTypes={["standalone"]}>
                  <Alerts />
                </ProtectedRoute>
              </Layout>
            }
          />

          <Route
            path="/reports"
            element={
              <Layout>
                <ProtectedRoute allowedOrgTypes={["standalone"]}>
                  <Reports />
                </ProtectedRoute>
              </Layout>
            }
          />

          <Route
            path="/upload"
            element={
              <Layout>
                <ProtectedRoute allowedOrgTypes={["standalone"]}>
                  <CSVUpload />
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
