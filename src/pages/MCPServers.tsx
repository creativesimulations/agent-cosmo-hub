/**
 * MCP Servers — manage Model Context Protocol providers.
 *
 * MCP is the open standard Hermes uses to plug in external tool servers
 * (GitHub, Linear, databases, custom internal tools). Anything an MCP
 * server exposes becomes a tool the agent can call.
 *
 * The page is intentionally read-only-ish: listing/inspecting is direct,
 * but adding / removing servers goes through the agent in chat so the
 * agent can validate the server, prompt for credentials via the intent
 * protocol, and reload toolsets after the change.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Network, Plug, Plus, RefreshCw, Loader2, AlertCircle, ExternalLink, ChevronDown, ChevronRight,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ActionableError from "@/components/ui/ActionableError";
import { systemAPI } from "@/lib/systemAPI";
import { useAgentConnection } from "@/contexts/AgentConnectionContext";
import { useChat } from "@/contexts/ChatContext";

interface MCPServer {
  name: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  transport?: string;
}

const MCPServers = () => {
  const navigate = useNavigate();
  const { connected } = useAgentConnection();
  const { setDraft } = useChat();
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [error, setError] = useState<string>("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!connected) { setLoading(false); return; }
    setLoading(true);
    setError("");
    const r = await systemAPI.listMCPServers();
    if (r.success) {
      setServers(r.servers);
    } else {
      setError(r.error || "Could not list MCP servers.");
      setServers([]);
    }
    setLoading(false);
  }, [connected]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter((s) =>
      s.name.toLowerCase().includes(q) || (s.command?.toLowerCase().includes(q) ?? false),
    );
  }, [servers, query]);

  const handleAddViaChat = () => {
    setDraft("Add an MCP server. Walk me through which one to install and what credentials you need.");
    navigate("/chat");
  };

  const handleRemoveViaChat = (name: string) => {
    setDraft(`Remove the MCP server "${name}" from my agent's config and reload toolsets.`);
    navigate("/chat");
  };

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  if (!connected) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            MCP Servers
          </h1>
          <p className="text-sm text-muted-foreground">External tool providers via Model Context Protocol</p>
        </div>
        <GlassCard className="flex items-center justify-center py-16">
          <div className="text-center space-y-3 max-w-md">
            <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No agent connected</p>
            <p className="text-xs text-muted-foreground/60">
              Connect your agent to manage its MCP servers.
            </p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {error && (
        <ActionableError
          title="Couldn't load MCP servers"
          summary={error}
          details={error}
          onFix={() => void load()}
          fixLabel="Retry"
        />
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            MCP Servers
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Plug external tool providers into your agent via the Model Context Protocol.
            Add a server and every tool it exposes (GitHub, Linear, databases, custom tools)
            becomes available to the agent automatically. Adding and removing servers happens
            in chat so the agent can collect any needed credentials safely.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleAddViaChat}
            className="gradient-primary text-primary-foreground"
          >
            <Plus className="w-4 h-4 mr-1" /> Add server
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open("https://modelcontextprotocol.io/", "_blank", "noopener,noreferrer")}
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" /> About MCP
          </Button>
        </div>
      </div>

      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search servers by name or command…"
          className="bg-background/50 border-white/10"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading MCP servers…
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="text-center py-12 space-y-3">
          <Plug className="w-10 h-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-foreground">
            {servers.length === 0 ? "No MCP servers configured yet." : "No servers match your search."}
          </p>
          {servers.length === 0 && (
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              MCP lets the agent talk to external tool servers — GitHub, Linear, your internal APIs.
              Click "Add server" and the agent will help you wire one up.
            </p>
          )}
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => {
            const isExpanded = expanded.has(s.name);
            return (
              <GlassCard key={s.name} className="p-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleExpand(s.name)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0">
                    <Plug className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{s.name}</p>
                    {s.command && (
                      <p className="text-[11px] font-mono text-muted-foreground truncate">{s.command}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.transport && (
                      <Badge variant="outline" className="border-white/10 text-[10px]">{s.transport}</Badge>
                    )}
                    {s.enabled === false ? (
                      <Badge variant="outline" className="border-muted-foreground/20 text-muted-foreground text-[10px]">
                        Disabled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-success/30 text-success text-[10px]">
                        Active
                      </Badge>
                    )}
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 py-3 border-t border-white/5 space-y-2">
                    {s.args && s.args.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Arguments</p>
                        <code className="text-[11px] font-mono text-foreground/80 break-all">{s.args.join(" ")}</code>
                      </div>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleRemoveViaChat(s.name)}
                      >
                        Remove via chat
                      </Button>
                    </div>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MCPServers;
