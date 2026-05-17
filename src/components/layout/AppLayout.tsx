import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import SetupStatusPill from "@/components/setup/SetupStatusPill";
import SudoPasswordDialog from "@/components/setup/SudoPasswordDialog";
import CapabilityApprovalDialog from "@/components/permissions/CapabilityApprovalDialog";
import SetupBlockingOverlay from "@/components/setup/SetupBlockingOverlay";
import { useSetup } from "@/contexts/SetupContext";
import { SudoPromptProvider } from "@/contexts/SudoPromptContext";
import { cn } from "@/lib/utils";

const AppLayout = () => {
  const { sudoPrompt, closeSudoPrompt, submitSudoPassword, sudoPasswordless, blocking } = useSetup();

  return (
    <SudoPromptProvider>
      <div className="relative flex min-h-screen gradient-bg">
        <div className={cn("flex min-h-screen flex-1 w-full", blocking.active && "pointer-events-none")}>
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
        <SetupBlockingOverlay blocking={blocking} />
      </div>
    </SudoPromptProvider>
  );
};

export default AppLayout;
