import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { enterLicenseKey, getUpgrade } from "@/lib/licenses";
import ActionableError from "@/components/ui/ActionableError";

interface EnterLicenseKeyDialogProps {
  /** Upgrade id to validate against (e.g. "discord", "browserbase"). */
  upgradeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful unlock. */
  onUnlocked?: () => void;
}

/**
 * Shared license-key entry dialog. Used by both the Upgrades page
 * (`UpgradeCard`) and the Browser Setup wizard's Browserbase paywall step,
 * so the UX is identical everywhere.
 */
const EnterLicenseKeyDialog = ({
  upgradeId,
  open,
  onOpenChange,
  onUnlocked,
}: EnterLicenseKeyDialogProps) => {
  const upgrade = getUpgrade(upgradeId);
  const [keyInput, setKeyInput] = useState("");
  const [validating, setValidating] = useState(false);
  const [actionError, setActionError] = useState("");

  const close = () => {
    setKeyInput("");
    setActionError("");
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!upgrade) return;
    setValidating(true);
    const result = await enterLicenseKey(upgrade.id, keyInput);
    setValidating(false);
    if (result === "ok") {
      setActionError("");
      toast.success(`${upgrade.name} unlocked`, {
        description: "Yours forever — including future updates.",
      });
      close();
      onUnlocked?.();
    } else if (result === "wrong") {
      setActionError(`That license key is for a different upgrade, not "${upgrade.name}".`);
      toast.error("Wrong upgrade", {
        description: `That license key is for a different upgrade, not "${upgrade.name}".`,
      });
    } else {
      setActionError("Invalid license key. Double-check the key from your purchase email.");
      toast.error("Invalid license key", {
        description: "Double-check the key from your purchase email. Whitespace is OK.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Enter your {upgrade?.name ?? "upgrade"} license key
          </DialogTitle>
          <DialogDescription>
            Paste the key from your purchase email. It will be stored securely on this device — and
            you can re-enter it on any device you own.
          </DialogDescription>
        </DialogHeader>
        {actionError && (
          <ActionableError
            title="License key couldn't be validated"
            summary={actionError}
            details={actionError}
            onFix={() => setActionError("")}
            fixLabel="Dismiss"
          />
        )}
        <div className="space-y-2">
          <Label htmlFor="license-key">License key</Label>
          <Input
            id="license-key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={`e.g. ${upgradeId}.eyJ1Ijoi…`}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-[10px] text-muted-foreground/70">
            Developer tip: a key starting with <code className="text-foreground/80">RONBOT-MASTER-</code> unlocks any upgrade for testing.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={validating}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={validating || !keyInput.trim()}>
            {validating ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Verifying…
              </>
            ) : (
              "Unlock"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EnterLicenseKeyDialog;
