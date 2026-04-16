import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "./components/layout/AppLayout";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import SubAgents from "./pages/SubAgents";
import LLMConfig from "./pages/LLMConfig";
import APIKeys from "./pages/APIKeys";
import Skills from "./pages/Skills";
import SettingsPage from "./pages/SettingsPage";
import TerminalPage from "./pages/TerminalPage";
import AgentChat from "./pages/AgentChat";
import LogViewer from "./pages/LogViewer";
import ConfigEditor from "./pages/ConfigEditor";
import UpdateManager from "./pages/UpdateManager";
import BackupRestore from "./pages/BackupRestore";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/agents" element={<SubAgents />} />
            <Route path="/models" element={<LLMConfig />} />
            <Route path="/keys" element={<APIKeys />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/terminal" element={<TerminalPage />} />
            <Route path="/chat" element={<AgentChat />} />
            <Route path="/logs" element={<LogViewer />} />
            <Route path="/config" element={<ConfigEditor />} />
            <Route path="/updates" element={<UpdateManager />} />
            <Route path="/backups" element={<BackupRestore />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
