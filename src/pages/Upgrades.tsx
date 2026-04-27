import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import UpgradeCard from "@/components/channels/UpgradeCard";
import { UPGRADES, isUpgradeUnlocked } from "@/lib/licenses";

const Upgrades = () => {
  const [unlocks, setUnlocks] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const map: Record<string, boolean> = {};
    for (const u of UPGRADES) map[u.id] = await isUpgradeUnlocked(u.id);
    setUnlocks(map);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Upgrades
        </h1>
        <p className="text-sm text-muted-foreground">
          One-time purchases. Yours forever, including future updates. Buy on our website, then paste your license key here.
        </p>
      </div>

      {loading ? (
        <GlassCard className="p-12 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </GlassCard>
      ) : UPGRADES.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <Sparkles className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No upgrades available yet — check back soon.</p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {UPGRADES.map((u) => (
            <UpgradeCard
              key={u.id}
              upgrade={u}
              unlocked={!!unlocks[u.id]}
              loading={loading}
              onChange={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Upgrades;
