import { useState } from "react";
import { Puzzle, Download, Check, ExternalLink } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Skill {
  id: string;
  name: string;
  description: string;
  category: "bundled" | "optional";
  enabled: boolean;
  installed: boolean;
}

const initialSkills: Skill[] = [
  { id: "web_search", name: "Web Search", description: "Search the web for information", category: "bundled", enabled: true, installed: true },
  { id: "code_exec", name: "Code Execution", description: "Execute Python code in sandbox", category: "bundled", enabled: true, installed: true },
  { id: "file_ops", name: "File Operations", description: "Read, write, and manage files", category: "bundled", enabled: true, installed: true },
  { id: "delegate", name: "Task Delegation", description: "Spawn and manage sub-agents", category: "bundled", enabled: true, installed: true },
  { id: "telegram", name: "Telegram Gateway", description: "Interact via Telegram bot", category: "optional", enabled: false, installed: true },
  { id: "discord", name: "Discord Gateway", description: "Interact via Discord bot", category: "optional", enabled: false, installed: false },
  { id: "email", name: "Email Integration", description: "Send and receive emails", category: "optional", enabled: false, installed: false },
  { id: "calendar", name: "Calendar Sync", description: "Manage calendar events", category: "optional", enabled: false, installed: false },
];

const Skills = () => {
  const [skills, setSkills] = useState(initialSkills);

  const toggleSkill = (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const bundled = skills.filter((s) => s.category === "bundled");
  const optional = skills.filter((s) => s.category === "optional");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Puzzle className="w-6 h-6 text-primary" />
          Skills Manager
        </h1>
        <p className="text-sm text-muted-foreground">Enable and manage agent capabilities</p>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bundled Skills</h2>
          <div className="grid grid-cols-2 gap-3">
            {bundled.map((skill) => (
              <GlassCard key={skill.id} variant="subtle" className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{skill.name}</p>
                  <p className="text-xs text-muted-foreground">{skill.description}</p>
                </div>
                <Switch checked={skill.enabled} onCheckedChange={() => toggleSkill(skill.id)} />
              </GlassCard>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Optional Skills</h2>
          <div className="grid grid-cols-2 gap-3">
            {optional.map((skill) => (
              <GlassCard key={skill.id} variant="subtle" className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{skill.name}</p>
                  <p className="text-xs text-muted-foreground">{skill.description}</p>
                </div>
                {skill.installed ? (
                  <Switch checked={skill.enabled} onCheckedChange={() => toggleSkill(skill.id)} />
                ) : (
                  <Button size="sm" variant="ghost" className="text-accent hover:text-accent text-xs">
                    <Download className="w-3 h-3 mr-1" /> Install
                  </Button>
                )}
              </GlassCard>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Skills;
