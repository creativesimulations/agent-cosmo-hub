import { motion } from "framer-motion";
import { Link2, FolderOpen, Loader2, Package } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import ronbotLogo from "@/assets/ronbot-logo.png";

type Props = {
  busy: boolean;
  onConnect: () => void;
  onInstall: () => void;
  onLocalFolder: () => void;
};

export function SetupHub({ busy, onConnect, onInstall, onLocalFolder }: Props) {
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
          disabled={busy}
          onClick={onConnect}
        />
        <HubCard
          icon={
            busy ? (
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            ) : (
              <Package className="w-6 h-6 text-accent" />
            )
          }
          title="Install Ronbot Agent"
          description={busy ? "Checking for existing install…" : "Official Hermes installer"}
          disabled={busy}
          onClick={onInstall}
          accent
        />
        <HubCard
          icon={<FolderOpen className="w-6 h-6 text-primary" />}
          title="Use My Own Agent"
          description="Install from a local source folder"
          disabled={busy}
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
  disabled,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <GlassCard
      className={cn(
        "cursor-pointer transition-all group",
        accent ? "hover:border-accent/30" : "hover:border-primary/30",
        disabled && "pointer-events-none opacity-60",
      )}
      onClick={disabled ? undefined : onClick}
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
