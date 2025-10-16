import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./hooks/useAuth";
// Update the path below to the correct location of TopNav, for example:
// import TopNav from "./common/TopNav";
// Update the path below to the correct location of TopNav, for example:
// import TopNav from "../components/TopNav";
// import TopNav from "./components/Navigation/TopNav";
import TopNav from "./components/TopNav";
// If TopNav is in another folder, adjust the path accordingly, e.g.:
// import TopNav from "../components/TopNav";
// import TopNav from "./components/Navigation/TopNav";
import Sidebar from "./components/Sidebar";
// Update the path below to the correct location of ProtectedRoute, for example:
// import ProtectedRoute from "../components/ProtectedRoute";
// import ProtectedRoute from "./common/ProtectedRoute";
// Update the path below to the correct location of ProtectedRoute, for example:
// import ProtectedRoute from "../components/ProtectedRoute";
// import ProtectedRoute from "./common/ProtectedRoute";
import ProtectedRoute from "./components/ProtectedRoute";
// import LoadingSpinner from "./components/LoadingSpinner";
// If LoadingSpinner is located elsewhere, update the path accordingly, e.g.:
// import LoadingSpinner from "./common/LoadingSpinner";
// Or, if you want to temporarily remove the spinner, use a fallback like below:
const LoadingSpinner = () => <div>Loading...</div>;
import "./styles/global.css";

const Dashboard = lazy(() => import("./pages/Dashboard"));
// Make sure the file exists at './pages/SitesList.tsx'.
// If the file is actually located elsewhere, update the path accordingly, for example:
const SitesList = lazy(() => import("./pages/SitesList")); // <-- Update path if needed
// Example: const SitesList = lazy(() => import("./components/SitesList"));
const SiteView = lazy(() => import("./pages/SiteView"));
const Login = lazy(() => import("./pages/Login"));
const Account = lazy(() => import("./pages/Account"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <div className="app-layout">
          <TopNav />
          <Sidebar />
          <main className="main-content">
            <Suspense fallback={<LoadingSpinner />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/sites" element={<ProtectedRoute><SitesList /></ProtectedRoute>} />
                <Route path="/sites/:id" element={<ProtectedRoute><SiteView /></ProtectedRoute>} />
                <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;