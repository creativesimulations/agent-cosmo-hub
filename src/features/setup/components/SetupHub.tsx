import { useEffect } from "react";
import { motion } from "framer-motion";
import { Link2, FolderOpen, Package } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import ronbotLogo from "@/assets/ronbot-logo.png";
import { probeAgent } from "@/features/setup/setupService";

type Props = {
  onConnect: () => void;
  onInstall: () => void;
  onLocalFolder: () => void;
};

export function SetupHub({ onConnect, onInstall, onLocalFolder }: Props) {
  useEffect(() => {
    void probeAgent({ useCache: false }).catch(() => undefined);
  }, []);

  return (
    <motion.div className="max-w-2xl w-full space-y-8">
      <header className="text-center space-y-4">
        <img src={ronbotLogo} alt="Ronbot" className="w-20 h-20 mx-auto" />
        <h1 className="text-4xl font-bold text-foreground tracking-tight">Ronbot</h1>
        <p className="text-muted-foreground text-lg">AI Agent Control Panel</p>
      </header>

      <motion.div className="grid sm:grid-cols-3 grid-cols-1 gap-4">
        <HubCard
          icon={<Link2 className="w-6 h-6 text-primary" />}
          title="Connect"
          description="Detect an agent at ~/.hermes"
          onClick={onConnect}
        />
        <HubCard
          icon={<Package className="w-6 h-6 text-accent" />}
          title="Install Ronbot Agent"
          description="Official Hermes installer"
          onClick={onInstall}
          accent
        />
        <HubCard
          icon={<FolderOpen className="w-6 h-6 text-primary" />}
          title="Use My Own Agent"
          description="Install from a local source folder"
          onClick={onLocalFolder}
        />
      </motion.div>
    </motion.div>
  );
}

function HubCard({
  icon,
  title,
  description,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <GlassCard
      className={cn(
        "cursor-pointer transition-all group",
        accent ? "hover:border-accent/30" : "hover:border-primary/30",
      )}
      onClick={onClick}
    >
      <motion.div className="space-y-3">
        <div
          className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
            accent ? "bg-accent/10 group-hover:bg-accent/20" : "bg-primary/10 group-hover:bg-primary/20",
          )}
        >
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </motion.div>
    </GlassCard>
  );
}
