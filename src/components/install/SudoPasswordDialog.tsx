import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, KeyRound, AlertTriangle } from "lucide-react";
import { sudoAPI, type SudoState } from "@/lib/systemAPI/sudo";

interface Props {
  open: boolean;
  /** What we need sudo for, shown to the user (e.g. "install ffmpeg and python3-venv"). */
  reason: string;
  onCancel: () => void;
  /** Called with a verified password. Component closes automatically on success. */
  onPassword: (password: string) => void;
  /** Called when no sudo is needed at all (passwordless). */
  onPasswordless: () => void;
}

/**
 * Securely collects (or sets up) the user's sudo password so the app can run
 * apt installs without sending the user to a terminal.
 *
 * Flow:
 *  1. probe sudo state on open
 *  2. passwordless → notify and close
 *  3. needs-password → ask, verify, return
 *  4. no-password-set → offer to set one (uses passwordless sudo + chpasswd)
 *  5. no-sudo → show manual instructions
 */
export default function SudoPasswordDialog({ open, reason, onCancel, onPassword, onPasswordless }: Props) {
  const [state, setState] = useState<SudoState | null>(null);
  const [probing, setProbing] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPassword("");
    setConfirm("");
    setProbing(true);
    sudoAPI.probe().then((s) => {
      // The "no-password-set" branch is only meaningful on fresh WSL where the
      // default user has passwordless sudo + no Linux password yet. On real
      // Linux and macOS users always have a password — coerce to "needs-password"
      // so we just show the password prompt instead of a confusing "set one" UI.
      const isElectronWSL =
        typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);
      if (s.kind === "no-password-set" && !isElectronWSL) {
        setState({ kind: "needs-password" });
      } else {
        setState(s);
      }
      setProbing(false);
      if (s.kind === "passwordless") {
        onPasswordless();
      }
    });
  }, [open, onPasswordless]);

  const handleSubmitPassword = async () => {
    if (!password) return;
    setWorking(true);
    setError(null);
    const result = await sudoAPI.verifyPassword(password);
    setWorking(false);
    if (result.valid) {
      onPassword(password);
    } else {
      setError(result.error || "Incorrect password");
    }
  };

  const handleSetPassword = async () => {
    if (!password || password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 4) {
      setError("Use at least 4 characters");
      return;
    }
    setWorking(true);
    setError(null);
    const setResult = await sudoAPI.setUserPassword(password);
    if (!setResult.success) {
      setWorking(false);
      setError((setResult.stderr || setResult.stdout || "Failed to set password").trim());
      return;
    }
    // Verify it works for sudo now
    const verify = await sudoAPI.verifyPassword(password);
    setWorking(false);
    if (verify.valid) {
      onPassword(password);
    } else {
      setError("Password was set but sudo verification failed: " + (verify.error ?? ""));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !working) onCancel(); }}>
      <DialogContent className="glass-card border-border/50 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-accent" />
            Administrator access needed
          </DialogTitle>
          <DialogDescription>
            We need to {reason}. Your password stays on this machine and is never logged or sent anywhere.
          </DialogDescription>
        </DialogHeader>

        {probing && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Checking system access...
          </div>
        )}

        {!probing && state?.kind === "no-sudo" && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              <code>sudo</code> isn't available in your environment. Please install it manually
              and retry.
            </AlertDescription>
          </Alert>
        )}

        {!probing && state?.kind === "needs-password" && (
          <div className="space-y-3">
            <Label htmlFor="sudo-pw" className="flex items-center gap-2">
              <KeyRound className="w-4 h-4" />
              Linux/WSL password for your user
            </Label>
            <Input
              id="sudo-pw"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmitPassword(); }}
              disabled={working}
              placeholder="••••••••"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {!probing && state?.kind === "no-password-set" && (
          <div className="space-y-3">
            <Alert>
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>
                Your Linux user has no password yet. Set one now so we can install system packages.
                You'll only need to do this once.
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={working}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">Confirm password</Label>
              <Input
                id="confirm-pw"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSetPassword(); }}
                disabled={working}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={working}>
            Cancel
          </Button>
          {state?.kind === "needs-password" && (
            <Button onClick={handleSubmitPassword} disabled={working || !password}>
              {working ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying</> : "Continue"}
            </Button>
          )}
          {state?.kind === "no-password-set" && (
            <Button onClick={handleSetPassword} disabled={working || !password || !confirm}>
              {working ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Setting password</> : "Set password & continue"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
