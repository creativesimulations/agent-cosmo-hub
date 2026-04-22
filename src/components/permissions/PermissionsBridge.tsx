import { useEffect } from "react";
import { usePermissions } from "@/contexts/PermissionsContext";
import {
  registerApprovalHandler,
  unregisterApprovalHandler,
  registerEventRecorder,
  unregisterEventRecorder,
} from "@/lib/approvalBridge";

/**
 * Tiny no-render component that registers the React PermissionsContext
 * functions onto the global approvalBridge so the non-React Hermes runner
 * (src/lib/systemAPI/hermes.ts) can call them.
 */
const PermissionsBridge = () => {
  const { requestApproval, recordEvent } = usePermissions();

  useEffect(() => {
    const handler = async (req: { action: never; target: string; reason?: string }) => {
      return requestApproval({ action: req.action, target: req.target, reason: req.reason });
    };
    registerApprovalHandler(handler as never);
    registerEventRecorder(recordEvent);
    return () => {
      unregisterApprovalHandler(handler as never);
      unregisterEventRecorder(recordEvent);
    };
  }, [requestApproval, recordEvent]);

  return null;
};

export default PermissionsBridge;
