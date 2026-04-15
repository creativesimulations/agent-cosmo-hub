import { useState, useEffect } from "react";
import { FileCode, Save, RotateCcw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { systemAPI } from "@/lib/systemAPI";

const fallbackConfig = `# Ronbot — Hermes Agent Configuration
# ~/.hermes/config.yaml

model: openrouter/nous/hermes-3-llama-3.1-70b
`;

const ConfigEditor = () => {
  const [config, setConfig] = useState(fallbackConfig);
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    const result = await systemAPI.readConfig();
    if (result.success && result.content) {
      setConfig(result.content);
    }
    setLoading(false);
    setSaved(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setConfig(e.target.value);
    setSaved(false);
    const errors: string[] = [];
    if (!e.target.value.includes("model:")) errors.push("Missing 'model' field");
    setValidationErrors(errors);
  };

  const handleSave = async () => {
    await systemAPI.writeConfig(config);
    setSaved(true);
  };

  const handleRevert = () => {
    loadConfig();
    setValidationErrors([]);
  };

  const lineCount = config.split("\n").length;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-[calc(100vh-2rem)]">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 h-[calc(100vh-2rem)] flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileCode className="w-6 h-6 text-primary" />
            Config Editor
          </h1>
          <p className="text-sm text-muted-foreground">Edit ~/.hermes/config.yaml</p>
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
            <CheckCircle2 className="w-3 h-3" /> Configuration saved
          </p>
        </div>
      )}

      <GlassCard className="flex-1 overflow-hidden p-0 flex">
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
        <span>~/.hermes/config.yaml — {lineCount} lines</span>
        <span>{saved ? "Saved" : "Unsaved changes"}</span>
      </div>
    </div>
  );
};

export default ConfigEditor;
