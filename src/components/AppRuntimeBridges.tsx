import { usePermissionsBridge } from "@/hooks/usePermissionsBridge";
import { useRonbotRulesBridge } from "@/hooks/useRonbotRulesBridge";

/**
 * Side-effect hooks that must run under PermissionsProvider + AgentConnectionProvider.
 * Replaces the former PermissionsBridge / RonbotRulesBridge no-UI components.
 */
export function AppRuntimeBridges() {
  usePermissionsBridge();
  useRonbotRulesBridge();
  return null;
}
