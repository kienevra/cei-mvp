import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
// import AuthProvider from the correct location
// Update the import path below if AuthProvider is in a different folder, for example:
import { AuthProvider } from "./hooks/useAuth";
// Or, if the file does not exist, create it as shown below.
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
        <main className="p-4">
          {children}
        </main>
      </div>
    </div>
  );
}
// NotFound is lazy-loaded above.

const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout><ProtectedRoute><Dashboard /></ProtectedRoute></Layout>} path="/" />
          <Route element={<Layout><ProtectedRoute><SitesList /></ProtectedRoute></Layout>} path="/sites" />
          <Route element={<Layout><ProtectedRoute><SiteView /></ProtectedRoute></Layout>} path="/sites/:id" />
          <Route element={<Layout><ProtectedRoute><CSVUpload /></ProtectedRoute></Layout>} path="/upload" />
          <Route element={<Layout><ProtectedRoute><Settings /></ProtectedRoute></Layout>} path="/settings" />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  </BrowserRouter>
);

export default App;