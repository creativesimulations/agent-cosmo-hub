import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface WhatsAppTerminalProps {
  content: string;
  resetKey: number;
  className?: string;
  onReadyChange?: (ready: boolean) => void;
}

const MAX_BUFFER_CHARS = 220_000;

const WhatsAppTerminal = ({ content, resetKey, className, onReadyChange }: WhatsAppTerminalProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const renderedLenRef = useRef(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      // Hermes QR/log streams can emit LF-only lines; convert to CRLF to avoid
      // cursor carry ("staircase" drift) that destroys QR/module alignment.
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", "Consolas", "Menlo", monospace',
      // Keep normal log readability; QR sizing should be handled separately.
      fontSize: 12,
      lineHeight: 1,
      letterSpacing: 0,
      rows: 30,
      cols: 90,
      scrollback: 3000,
      theme: {
        background: "#0b0f14",
        foreground: "#d7e0ea",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    fitAddon.fit();
    termRef.current = term;
    fitRef.current = fitAddon;
    renderedLenRef.current = 0;
    onReadyChange?.(true);

    const onResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      onReadyChange?.(false);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      renderedLenRef.current = 0;
    };
  }, [onReadyChange, resetKey]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (!content) {
      term.clear();
      term.reset();
      renderedLenRef.current = 0;
      return;
    }
    // If caller reset the stream, re-render full buffer.
    if (content.length < renderedLenRef.current) {
      term.clear();
      term.reset();
      term.write(content);
      renderedLenRef.current = content.length;
      return;
    }
    const nextChunk = content.slice(renderedLenRef.current);
    if (!nextChunk) return;
    term.write(nextChunk);
    renderedLenRef.current = content.length;
  }, [content]);

  useEffect(() => {
    if (content.length <= MAX_BUFFER_CHARS) return;
    const term = termRef.current;
    if (!term) return;
    const trimmed = content.slice(-MAX_BUFFER_CHARS);
    term.clear();
    term.reset();
    term.write(trimmed);
    renderedLenRef.current = trimmed.length;
  }, [content]);

  return (
    <div
      ref={hostRef}
      className={className ?? "h-full w-full rounded-md border border-border/60 bg-black/90 overflow-hidden"}
      aria-label="WhatsApp terminal output"
    />
  );
};

export default WhatsAppTerminal;
