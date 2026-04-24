import { Sparkles } from "lucide-react";
import PermissionsPanel from "@/components/permissions/PermissionsPanel";
import CapabilitiesPanel from "@/components/permissions/CapabilitiesPanel";

const Advanced = () => {
  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Advanced
        </h1>
        <p className="text-sm text-muted-foreground">
          Power-user controls for capability approvals and low-level agent permissions.
        </p>
      </div>

      <PermissionsPanel />
      <CapabilitiesPanel />
    </div>
  );
};

export default Advanced;

