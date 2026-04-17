import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import InstallStatusPill from "@/components/install/InstallStatusPill";

const AppLayout = () => {
  return (
    <div className="flex min-h-screen gradient-bg">
      <AppSidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      <InstallStatusPill />
    </div>
  );
};

export default AppLayout;
