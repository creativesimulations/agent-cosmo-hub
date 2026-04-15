import { useState } from "react";
import { FileCode, Save, RotateCcw, CheckCircle2, AlertCircle } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const defaultConfig = `# Hermes Agent Configuration
# config.yaml

agent:
  name: "my-hermes-agent"
  version: "0.1.0"
  max_sub_agents: 10
  auto_restart: true

gateway:
  host: "0.0.0.0"
  port: 8000
  platforms:
    - name: "rest_api"
      enabled: true
    - name: "telegram"
      enabled: false
      token: "\${TELEGRAM_BOT_TOKEN}"
    - name: "discord"
      enabled: false
      token: "\${DISCORD_BOT_TOKEN}"

providers:
  default: "openai"
  auxiliary: "anthropic"
  models:
    - provider: "openai"
      model: "gpt-4o"
      enabled: true
    - provider: "anthropic"
      model: "claude-3.5-sonnet"
      enabled: true
    - provider: "ollama"
      model: "llama3.1"
      endpoint: "http://localhost:11434"
      enabled: false

logging:
  level: "info"
  file: "hermes.log"
  max_size: "50MB"
  rotation: true

scheduler:
  jobs:
    - name: "health_check"
      cron: "*/5 * * * *"
      enabled: true
    - name: "log_rotation"
      cron: "0 0 * * *"
      enabled: true`;

const ConfigEditor = () => {
  const [config, setConfig] = useState(defaultConfig);
  const [saved, setSaved] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setConfig(e.target.value);
    setSaved(false);
    // Simple validation
    const errors: string[] = [];
    if (!e.target.value.includes("agent:")) errors.push("Missing 'agent' section");
    if (!e.target.value.includes("gateway:")) errors.push("Missing 'gateway' section");
    setValidationErrors(errors);
  };

  const handleSave = () => {
    setSaved(true);
  };

  const handleRevert = () => {
    setConfig(defaultConfig);
    setSaved(true);
    setValidationErrors([]);
  };

  const lineCount = config.split("\n").length;

  return (
    <div className="p-6 space-y-4 h-[calc(100vh-2rem)] flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileCode className="w-6 h-6 text-primary" />
            Config Editor
          </h1>
          <p className="text-sm text-muted-foreground">Edit your Hermes agent configuration</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRevert} className="text-muted-foreground hover:text-foreground">
            <RotateCcw className="w-4 h-4 mr-1" /> Revert
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saved || validationErrors.length > 0}
            className="gradient-primary text-primary-foreground"
          >
            <Save className="w-4 h-4 mr-1" /> Save
          </Button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div className="glass-subtle rounded-lg p-3 border border-destructive/20 space-y-1">
          {validationErrors.map((err, i) => (
            <p key={i} className="text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="w-3 h-3" /> {err}
            </p>
          ))}
        </div>
      )}

      {saved && validationErrors.length === 0 && (
        <div className="glass-subtle rounded-lg p-2 border border-success/20">
          <p className="text-xs text-success flex items-center gap-2">
            <CheckCircle2 className="w-3 h-3" /> Configuration is valid and saved
          </p>
        </div>
      )}

      <GlassCard className="flex-1 overflow-hidden p-0 flex">
        {/* Line numbers */}
        <div className="py-4 px-3 border-r border-white/5 select-none overflow-hidden">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="text-xs text-muted-foreground/40 font-mono leading-6 text-right">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          value={config}
          onChange={handleChange}
          className="flex-1 bg-transparent text-sm font-mono text-foreground/90 p-4 resize-none outline-none leading-6 overflow-auto"
          spellCheck={false}
        />
      </GlassCard>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>config.yaml — {lineCount} lines</span>
        <span>{saved ? "Saved" : "Unsaved changes"}</span>
      </div>
    </div>
  );
};

export default ConfigEditor;
