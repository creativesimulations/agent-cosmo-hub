import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import SetupStatusPill from "@/components/setup/SetupStatusPill";
import SudoPasswordDialog from "@/components/setup/SudoPasswordDialog";
import CapabilityApprovalDialog from "@/components/permissions/CapabilityApprovalDialog";
import { useSetup } from "@/contexts/SetupContext";
import { SudoPromptProvider } from "@/contexts/SudoPromptContext";

const AppLayout = () => {
  const { sudoPrompt, closeSudoPrompt, submitSudoPassword, sudoPasswordless } = useSetup();

  return (
    <SudoPromptProvider>
      <div className="flex min-h-screen gradient-bg">
        <AppSidebar />
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
        <SetupStatusPill />
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
