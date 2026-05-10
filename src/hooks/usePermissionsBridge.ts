import { useEffect } from "react";
import { usePermissions } from "@/contexts/PermissionsContext";
import {
  registerApprovalHandler,
  unregisterApprovalHandler,
  registerEventRecorder,
  unregisterEventRecorder,
} from "@/lib/approvalBridge";

/** Registers PermissionsContext onto approvalBridge for Hermes IPC code paths. */
export function usePermissionsBridge(): void {
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
}
