import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import LiveLotMapPage from './pages/LiveLotMapPage';
import AdaptiveLayoutPage from './pages/AdaptiveLayoutPage';
import LaserControlPage from './pages/LaserControlPage';
import VehiclesSessionsPage from './pages/VehiclesSessionsPage';
import DevicesSensorsPage from './pages/DevicesSensorsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import AlertsPage from './pages/AlertsPage';
import SettingsPage from './pages/SettingsPage';
import DriverViewPage from './pages/DriverViewPage';
import LiveDemoPage from './pages/LiveDemoPage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-lightGray flex items-center justify-center text-xs font-mono text-slate-500">
        Authenticating session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/driver" element={<DriverViewPage />} />

          {/* Protected Control Room Routes */}
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/lot-map" element={<ProtectedRoute><LiveLotMapPage /></ProtectedRoute>} />
          <Route path="/adaptive-layout" element={<ProtectedRoute><AdaptiveLayoutPage /></ProtectedRoute>} />
          <Route path="/live-demo" element={<ProtectedRoute><LiveDemoPage /></ProtectedRoute>} />
          <Route path="/laser-control" element={<ProtectedRoute><LaserControlPage /></ProtectedRoute>} />
          <Route path="/sessions" element={<ProtectedRoute><VehiclesSessionsPage /></ProtectedRoute>} />
          <Route path="/devices" element={<ProtectedRoute><DevicesSensorsPage /></ProtectedRoute>} />
          <Route path="/analytics" element={<ProtectedRoute><AnalyticsPage /></ProtectedRoute>} />
          <Route path="/alerts" element={<ProtectedRoute><AlertsPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
