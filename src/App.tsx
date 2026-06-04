import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "./components/layout/AppLayout";
import { SetupProvider } from "./contexts/SetupContext";
import { AgentConnectionProvider } from "./contexts/AgentConnectionContext";
import { ChatProvider } from "./contexts/ChatContext";
import { SettingsProvider } from "./contexts/SettingsContext";
import { PermissionsProvider } from "./contexts/PermissionsContext";
import { CapabilitiesProvider } from "./contexts/CapabilitiesContext";
import ApprovalDialog from "./components/permissions/ApprovalDialog";
import { AppRuntimeBridges } from "./components/AppRuntimeBridges";
import WelcomeDialog from "./components/companion/WelcomeDialog";
import SetupInstallPage from "./pages/SetupInstallPage";
import RootRoute from "./pages/RootRoute";
import SubAgents from "./pages/SubAgents";
import LLMConfig from "./pages/LLMConfig";
import Secrets from "./pages/Secrets";
import Skills from "./pages/Skills";
import SettingsPage from "./pages/SettingsPage";
import TerminalPage from "./pages/TerminalPage";
import Channels from "./pages/Channels";
import UpdateManager from "./pages/UpdateManager";
import BackupRestore from "./pages/BackupRestore";
import Diagnostics from "./pages/Diagnostics";

import Scheduled from "./pages/Scheduled";
import Insights from "./pages/Insights";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <SettingsProvider>
          <PermissionsProvider>
            <ApprovalDialog />
            <AgentConnectionProvider>
              <AppRuntimeBridges />
              <CapabilitiesProvider>
                <SetupProvider>
                  <ChatProvider>
                    <WelcomeDialog />
                    <Routes>
                        <Route element={<AppLayout />}>
                          <Route path="/" element={<RootRoute />} />
                          <Route path="/install" element={<SetupInstallPage />} />
                          <Route path="/dashboard" element={<Navigate to="/" replace />} />
                          <Route path="/agents" element={<SubAgents />} />
                          <Route path="/models" element={<LLMConfig />} />
                          <Route path="/secrets" element={<Secrets />} />
                          {/* Legacy redirect */}
                          <Route path="/keys" element={<Secrets />} />
                          <Route path="/skills" element={<Skills />} />
                          <Route path="/settings" element={<SettingsPage />} />
                          <Route path="/terminal" element={<TerminalPage />} />
                          <Route path="/channels" element={<Channels />} />

                          <Route path="/updates" element={<UpdateManager />} />
                          <Route path="/backups" element={<BackupRestore />} />
                          <Route path="/diagnostics" element={<Diagnostics />} />
                          <Route path="/scheduled" element={<Scheduled />} />
                          <Route path="/insights" element={<Insights />} />
                        </Route>
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                  </ChatProvider>
                </SetupProvider>
              </CapabilitiesProvider>
            </AgentConnectionProvider>
          </PermissionsProvider>
        </SettingsProvider>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
