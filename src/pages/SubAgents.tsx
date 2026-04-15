import { Network, Pause, X, ChevronRight } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentNode {
  id: string;
  name: string;
  status: "online" | "busy" | "offline";
  task: string;
  model: string;
  tokens: string;
  children?: AgentNode[];
}

const agentTree: AgentNode = {
  id: "root",
  name: "ron-main",
  status: "online",
  task: "Orchestrating multi-step workflow",
  model: "gpt-4o",
  tokens: "45.2k",
  children: [
    {
      id: "a1",
      name: "research-agent",
      status: "busy",
      task: "Analyzing market trends for Q4",
      model: "gpt-4o",
      tokens: "12.4k",
      children: [
        { id: "a1-1", name: "web-scraper", status: "busy", task: "Scraping financial data", model: "gpt-4o-mini", tokens: "2.1k" },
      ],
    },
    { id: "a2", name: "code-writer", status: "busy", task: "Implementing REST API endpoints", model: "claude-3.5-sonnet", tokens: "8.2k" },
    { id: "a3", name: "data-parser", status: "busy", task: "Processing CSV dataset", model: "gpt-4o-mini", tokens: "3.1k" },
  ],
};

const AgentTreeNode = ({ node, depth = 0 }: { node: AgentNode; depth?: number }) => {
  return (
    <div className="space-y-2">
      <div
        className={cn(
          "glass-subtle rounded-lg p-4 flex items-center justify-between hover:border-primary/20 transition-all",
          depth === 0 && "border-primary/20 glow-primary"
        )}
        style={{ marginLeft: depth * 24 }}
      >
        <div className="flex items-center gap-3">
          {node.children && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <StatusBadge status={node.status === "busy" ? "busy" : node.status} />
          <div>
            <p className="text-sm font-medium text-foreground font-mono">{node.name}</p>
            <p className="text-xs text-muted-foreground">{node.task}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono text-accent">{node.model}</span>
          <span className="text-xs text-muted-foreground">{node.tokens}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-warning">
              <Pause className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
      {node.children?.map((child) => (
        <AgentTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
};

const SubAgents = () => {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Network className="w-6 h-6 text-primary" />
          Sub-Agent Monitor
        </h1>
        <p className="text-sm text-muted-foreground">View the agent hierarchy and manage sub-agents</p>
      </div>

      <GlassCard>
        <AgentTreeNode node={agentTree} />
      </GlassCard>
    </div>
  );
};

export default SubAgents;
