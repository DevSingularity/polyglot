import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from '@/features/auth';
import { ThemeProvider } from '@/features/theme';

import { PublicGuard, PrivateGuard } from '@/features/auth';

import Layout from '@/components/layout/Layout';

import { LandingPage } from '@/components/landing/LandingPage';
import { LoginPage, SignupPage } from '@/features/auth';
import { DashboardPage } from '@/features/dashboard';
import { UploadRepoPage, GraphPage } from '@/features/graph';
import { AnalyzeFilePage, AnalyzePage } from '@/features/analyze';
import { AskPage } from '@/features/ai';
import ImpactPanel from '@/features/graph/pages/ImpactPanel';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      <Route element={<PublicGuard />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      <Route element={<PrivateGuard />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/upload-repo" element={<UploadRepoPage />} />
          <Route path="/analyze" element={<AnalyzePage />} />
          <Route path="/analyze/file" element={<AnalyzeFilePage />} />
          <Route path="/analyze/:dir_name" element={<AnalyzePage />} />
          <Route path="/analyze/:dir_name/file" element={<AnalyzeFilePage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/impact" element={<ImpactPanel />} />
          <Route path="/ask" element={<AskPage />} />
        </Route>
      </Route>

      {/* Unknown routes go back to Landing Page */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <AppRoutes />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
