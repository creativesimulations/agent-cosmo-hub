import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "./components/layout/AppLayout";
import { InstallProvider } from "./contexts/InstallContext";
import { AgentConnectionProvider } from "./contexts/AgentConnectionContext";
import { ChatProvider } from "./contexts/ChatContext";
import { SettingsProvider } from "./contexts/SettingsContext";
import { PermissionsProvider } from "./contexts/PermissionsContext";
import ApprovalDialog from "./components/permissions/ApprovalDialog";
import PermissionsBridge from "./components/permissions/PermissionsBridge";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import SubAgents from "./pages/SubAgents";
import LLMConfig from "./pages/LLMConfig";
import Secrets from "./pages/Secrets";
import Skills from "./pages/Skills";
import SettingsPage from "./pages/SettingsPage";
import TerminalPage from "./pages/TerminalPage";
import AgentChat from "./pages/AgentChat";
import Channels from "./pages/Channels";
import LogViewer from "./pages/LogViewer";
import UpdateManager from "./pages/UpdateManager";
import BackupRestore from "./pages/BackupRestore";
import Diagnostics from "./pages/Diagnostics";
import Upgrades from "./pages/Upgrades";
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
        <PermissionsBridge />
        <ApprovalDialog />
        <AgentConnectionProvider>
        <InstallProvider>
        <ChatProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/agents" element={<SubAgents />} />
            <Route path="/models" element={<LLMConfig />} />
            <Route path="/secrets" element={<Secrets />} />
            {/* Legacy redirect */}
            <Route path="/keys" element={<Secrets />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/terminal" element={<TerminalPage />} />
            <Route path="/chat" element={<AgentChat />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/logs" element={<LogViewer />} />
            <Route path="/upgrades" element={<Upgrades />} />
            <Route path="/updates" element={<UpdateManager />} />
            <Route path="/backups" element={<BackupRestore />} />
            <Route path="/diagnostics" element={<Diagnostics />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ChatProvider>
        </InstallProvider>
        </AgentConnectionProvider>
        </PermissionsProvider>
        </SettingsProvider>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
