import { useState } from "react";
import { ExternalLink, KeyRound, Loader2, Lock, Sparkles, CheckCircle2 } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
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
import { Upgrade, enterLicenseKey, removeLicenseKey } from "@/lib/licenses";

interface UpgradeCardProps {
  upgrade: Upgrade;
  unlocked: boolean;
  loading?: boolean;
  onChange: () => void;
}

const openExternal = (url: string) => {
  // Electron + browser both honor target=_blank.
  window.open(url, "_blank", "noopener,noreferrer");
};

const UpgradeCard = ({ upgrade, unlocked, loading, onChange }: UpgradeCardProps) => {
  const [enterOpen, setEnterOpen] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [validating, setValidating] = useState(false);

  const handleSubmit = async () => {
    setValidating(true);
    const result = await enterLicenseKey(upgrade.id, keyInput);
    setValidating(false);
    if (result === "ok") {
      toast.success(`${upgrade.name} unlocked`, {
        description: "Yours forever — including future updates.",
      });
      setEnterOpen(false);
      setKeyInput("");
      onChange();
    } else if (result === "wrong") {
      toast.error("Wrong upgrade", {
        description: `That license key is for a different upgrade, not "${upgrade.name}".`,
      });
    } else {
      toast.error("Invalid license key", {
        description: "Double-check the key from your purchase email. Whitespace is OK.",
      });
    }
  };

  const handleRemove = async () => {
    const ok = await removeLicenseKey(upgrade.id);
    if (ok) {
      toast.info(`${upgrade.name} license removed from this device`);
      onChange();
    }
  };

  return (
    <>
      <GlassCard className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">{upgrade.name}</h3>
              <p className="text-[11px] text-muted-foreground">{upgrade.priceLabel} · lifetime · free updates</p>
            </div>
          </div>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : unlocked ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-success">
              <CheckCircle2 className="w-3 h-3" /> Unlocked
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Lock className="w-3 h-3" /> Locked
            </span>
          )}
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">{upgrade.description}</p>

        {unlocked ? (
          <Button variant="outline" size="sm" onClick={handleRemove} className="w-full">
            Remove license from this device
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => openExternal(upgrade.buyUrl)}
              className="gradient-primary text-primary-foreground"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Buy
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEnterOpen(true)}>
              <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Enter key
            </Button>
          </div>
        )}
      </GlassCard>

      <Dialog open={enterOpen} onOpenChange={setEnterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter your {upgrade.name} license key</DialogTitle>
            <DialogDescription>
              Paste the key from your purchase email. It will be stored securely on this device — and
              you can re-enter it on any device you own.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="license-key">License key</Label>
            <Input
              id="license-key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="e.g. discord.eyJ1Ijoi…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnterOpen(false)} disabled={validating}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={validating || !keyInput.trim()}>
              {validating ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Verifying…</> : "Unlock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UpgradeCard;
