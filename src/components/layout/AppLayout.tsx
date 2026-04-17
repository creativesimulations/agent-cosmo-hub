import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import InstallStatusPill from "@/components/install/InstallStatusPill";
import SudoPasswordDialog from "@/components/install/SudoPasswordDialog";
import { useInstall } from "@/contexts/InstallContext";

const AppLayout = () => {
  const { sudoPrompt, closeSudoPrompt, submitSudoPassword, sudoPasswordless } = useInstall();

  return (
    <div className="flex min-h-screen gradient-bg">
      <AppSidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      <InstallStatusPill />
      <SudoPasswordDialog
        open={sudoPrompt.open}
        reason={sudoPrompt.reason}
        onCancel={closeSudoPrompt}
        onPassword={submitSudoPassword}
        onPasswordless={sudoPasswordless}
      />
    </div>
  );
};

export default AppLayout;
