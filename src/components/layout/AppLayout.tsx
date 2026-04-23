import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import InstallStatusPill from "@/components/install/InstallStatusPill";
import SudoPasswordDialog from "@/components/install/SudoPasswordDialog";
import CapabilityApprovalDialog from "@/components/permissions/CapabilityApprovalDialog";
import { useInstall } from "@/contexts/InstallContext";
import { SudoPromptProvider } from "@/contexts/SudoPromptContext";

const AppLayout = () => {
  const { sudoPrompt, closeSudoPrompt, submitSudoPassword, sudoPasswordless } = useInstall();

  return (
    <SudoPromptProvider>
      <div className="flex min-h-screen gradient-bg">
        <AppSidebar />
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
        <InstallStatusPill />
        {/* Install-flow sudo dialog (separate channel from the generic one). */}
        <SudoPasswordDialog
          open={sudoPrompt.open}
          reason={sudoPrompt.reason}
          onCancel={closeSudoPrompt}
          onPassword={submitSudoPassword}
          onPasswordless={sudoPasswordless}
        />
        <CapabilityApprovalDialog />
      </div>
    </SudoPromptProvider>
  );
};

export default AppLayout;
