import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Copy, Download, Trash2, CheckCircle2, XCircle, Clock, Search } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { diagnostics, type DiagEntry } from "@/lib/diagnostics";
import { toast } from "@/hooks/use-toast";

const CommandLogCard = () => {
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAllCommands, setShowAllCommands] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandScope, setCommandScope] = useState<"all" | "gateway" | "whatsapp" | "hermes" | "system">("all");

  useEffect(() => {
    const unsub = diagnostics.subscribe((all) => setEntries(all.slice().reverse()));
    return unsub;
  }, []);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const visibleEntries = (showAllCommands ? entries : entries.filter((e) => !e.success)).filter((e) => {
    const scopeMatch =
      commandScope === "all" ||
      (commandScope === "gateway" && /gateway/i.test(e.command)) ||
      (commandScope === "whatsapp" && /whatsapp|baileys/i.test(e.command + e.stdout + e.stderr)) ||
      (commandScope === "hermes" && /hermes/i.test(e.command)) ||
      (commandScope === "system" && !/hermes|gateway|whatsapp|baileys/i.test(e.command));
    if (!scopeMatch) return false;
    const q = commandQuery.trim().toLowerCase();
    if (!q) return true;
    return [e.command, e.stdout, e.stderr, e.cwd || "", e.label].join("\n").toLowerCase().includes(q);
  });

  const copyAll = async () => {
    await navigator.clipboard.writeText(diagnostics.toText());
    toast({ title: "Copied", description: `${entries.length} log entries copied` });
  };

  const copyLatestFailureBundle = async () => {
    const firstFail = entries.find((e) => !e.success);
    if (!firstFail) {
      toast({ title: "No failures", description: "There are no failing command entries to copy." });
      return;
    }
    const payload = [
      `label=${firstFail.label}`,
      `time=${new Date(firstFail.timestamp).toISOString()}`,
      `cwd=${firstFail.cwd || "(unknown)"}`,
      `phase=${firstFail.phase}`,
      `exit=${firstFail.exitCode ?? "—"}`,
      `status=${firstFail.status}`,
      "",
      "$ " + firstFail.command,
      firstFail.stdout ? `\n--- stdout ---\n${firstFail.stdout}` : "",
      firstFail.stderr ? `\n--- stderr ---\n${firstFail.stderr}` : "",
    ].filter(Boolean).join("\n");
    await navigator.clipboard.writeText(payload);
    toast({ title: "Copied latest failure bundle", description: "Redacted command details copied." });
  };

  const downloadFiltered = () => {
    const body = visibleEntries.map((e) =>
      [
        `time=${new Date(e.timestamp).toISOString()} label=${e.label} phase=${e.phase} status=${e.status} exit=${e.exitCode ?? "—"} duration=${e.durationMs}ms`,
        `cwd=${e.cwd || "(unknown)"}`,
        `$ ${e.command}`,
        e.stdout ? `--- stdout ---\n${e.stdout.trimEnd()}` : "",
        e.stderr ? `--- stderr ---\n${e.stderr.trimEnd()}` : "",
      ].filter(Boolean).join("\n")
    ).join("\n\n");
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ronbot-app-diagnostics-filtered-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    const blob = new Blob([diagnostics.toText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ronbot-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Runtime command telemetry <span className="text-muted-foreground font-normal">({visibleEntries.length} shown / {entries.length} total)</span>
        </h2>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setShowAllCommands((v) => !v)}>
            {showAllCommands ? "Hide successful" : "Show all"}
          </Button>
          <Button size="sm" variant="ghost" onClick={copyLatestFailureBundle}>Copy latest failure</Button>
          <Button size="sm" variant="ghost" onClick={downloadFiltered}>Download filtered</Button>
          <Button size="sm" variant="ghost" onClick={copyAll}><Copy className="w-3 h-3 mr-1" /> Copy</Button>
          <Button size="sm" variant="ghost" onClick={downloadAll}><Download className="w-3 h-3 mr-1" /> Download</Button>
          <Button size="sm" variant="ghost" onClick={() => diagnostics.clear()}><Trash2 className="w-3 h-3 mr-1" /> Clear</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[280px] flex-1">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={commandQuery}
            onChange={(e) => setCommandQuery(e.target.value)}
            placeholder="Search command, output, cwd..."
            className="w-full h-8 pl-8 pr-2 rounded-md border border-border/60 bg-background/50 text-xs"
          />
        </div>
        {(["all", "gateway", "whatsapp", "hermes", "system"] as const).map((scope) => (
          <Button
            key={scope}
            size="sm"
            variant={commandScope === scope ? "default" : "ghost"}
            onClick={() => setCommandScope(scope)}
          >
            {scope}
          </Button>
        ))}
      </div>

      {visibleEntries.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          {entries.length === 0
            ? "No commands recorded yet. Trigger a sync, doctor, or chat to populate the log."
            : "No failing commands in the current log."}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
          {visibleEntries.map((e) => {
            const isOpen = expanded.has(e.id);
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border border-white/5 rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(e.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 text-left"
                >
                  {e.success
                    ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    : <XCircle className="w-4 h-4 text-destructive shrink-0" />}
                  <span className="text-[10px] font-mono text-muted-foreground w-16 shrink-0">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                  <Badge variant="outline" className="text-[9px] py-0 px-1">{e.label}</Badge>
                  <span className="text-xs font-mono truncate flex-1 text-muted-foreground">{e.command}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3" />{e.durationMs}ms · {e.phase} · exit={e.exitCode ?? "—"}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-2 text-[11px] font-mono">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="p-2 rounded bg-background/40 border border-white/5">
                        <p className="text-muted-foreground mb-1">cwd</p>
                        <p className="break-all">{e.cwd || "(unknown)"}</p>
                      </div>
                      <div className="p-2 rounded bg-background/40 border border-white/5">
                        <p className="text-muted-foreground mb-1">status</p>
                        <p>{e.status}{e.redacted ? " · redacted" : ""}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Command</p>
                      <pre className="p-2 rounded bg-background/40 border border-white/5 whitespace-pre-wrap break-all">{e.command}</pre>
                    </div>
                    {e.stdout && (
                      <div>
                        <p className="text-muted-foreground mb-1">stdout</p>
                        <pre className="p-2 rounded bg-background/40 border border-white/5 whitespace-pre-wrap max-h-64 overflow-auto">{e.stdout}</pre>
                      </div>
                    )}
                    {e.stderr && (
                      <div>
                        <p className="text-destructive/80 mb-1">stderr</p>
                        <pre className="p-2 rounded bg-background/40 border border-destructive/20 whitespace-pre-wrap max-h-64 overflow-auto">{e.stderr}</pre>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
};

export default CommandLogCard;
