import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import SudoPasswordDialog from "@/components/install/SudoPasswordDialog";
import { promptForPasswordMac } from "@/lib/systemAPI/sudo";
import { systemAPI } from "@/lib/systemAPI";

/**
 * Generic in-app sudo password collection.
 *
 * Returns:
 *   - a non-empty string  → password the caller can hand to `sudoAPI.aptInstall`
 *   - ""                  → passwordless sudo is available; pass any value to apt
 *   - null                → user cancelled / sudo unavailable
 *
 * On macOS we try the native osascript dialog first so the password never
 * lives in a renderer text field. On Linux/WSL we fall back to the in-app
 * SudoPasswordDialog (same component InstallContext uses).
 */
export interface SudoPromptContextValue {
  /** Open the sudo dialog (or native macOS prompt) and resolve with the result. */
  requestSudoPassword: (reason: string) => Promise<string | null>;
}

const SudoPromptContext = createContext<SudoPromptContextValue | null>(null);

export const SudoPromptProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const resolverRef = useRef<((value: string | null) => void) | null>(null);

  const settle = useCallback((value: string | null) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    setReason("");
    resolver?.(value);
  }, []);

  const requestSudoPassword = useCallback(
    async (nextReason: string): Promise<string | null> => {
      // macOS native GUI prompt first.
      try {
        const platform = await systemAPI.getPlatform();
        if (platform.isMac) {
          const macPw = await promptForPasswordMac(`Ronbot needs to ${nextReason}.`);
          if (macPw) return macPw;
          // fall through to in-app dialog if user cancelled osascript
        }
      } catch {
        /* swallow — fall through */
      }

      return new Promise<string | null>((resolve) => {
        resolverRef.current = resolve;
        setReason(nextReason);
        setOpen(true);
      });
    },
    [],
  );

  return (
    <SudoPromptContext.Provider value={{ requestSudoPassword }}>
      {children}
      <SudoPasswordDialog
        open={open}
        reason={reason}
        onCancel={() => settle(null)}
        onPassword={(pw) => settle(pw)}
        onPasswordless={() => settle("")}
      />
    </SudoPromptContext.Provider>
  );
};

export const useSudoPrompt = (): SudoPromptContextValue => {
  const ctx = useContext(SudoPromptContext);
  if (!ctx) throw new Error("useSudoPrompt must be used within SudoPromptProvider");
  return ctx;
};
