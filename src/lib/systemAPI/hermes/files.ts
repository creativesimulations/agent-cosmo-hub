import { coreAPI } from "../core";
import { encodeScript, runHermesShell } from "./shell";

export const readHermesFile = async (
  targetPath: string,
): Promise<{ success: boolean; content?: string; error?: string }> => {
  const result = await runHermesShell(
    [
      `TARGET="${targetPath}"`,
      'if [ -f "$TARGET" ]; then',
      '  cat "$TARGET"',
      "else",
      "  exit 3",
      "fi",
    ].join("\n"),
  );

  if (result.success) return { success: true, content: result.stdout };
  if (result.code === 3) return { success: false, error: "File not found" };

  return { success: false, error: result.stderr || result.stdout || "Failed to read Hermes file" };
};

export const writeHermesFile = async (
  targetPath: string,
  content: string,
  mode?: string,
): Promise<{ success: boolean; error?: string }> => {
  const platform = await coreAPI.getPlatform();

  if (platform.isWindows) {
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const winTmpDir = `${platform.homeDir}\\.ronbot\\tmp`;
    const winTmpFile = `${winTmpDir}\\write-${stamp}.dat`;
    await coreAPI.mkdir(winTmpDir);
    const wrote = await coreAPI.writeFile(winTmpFile, content);
    if (!wrote.success) {
      return { success: false, error: wrote.error || "Failed to stage file content" };
    }
    const drive = winTmpFile[0].toLowerCase();
    const wslSource = `/mnt/${drive}${winTmpFile.slice(2).replace(/\\/g, "/")}`;
    const script = [
      "set -e",
      `TARGET="${targetPath}"`,
      'mkdir -p "$(dirname "$TARGET")"',
      `cp "${wslSource}" "$TARGET"`,
      `rm -f "${wslSource}" 2>/dev/null || true`,
      ...(mode ? [`chmod ${mode} "$TARGET" || true`] : []),
      'echo "[writeHermesFile] wrote $TARGET"',
    ].join("\n");
    const b64 = encodeScript(script);
    const result = await coreAPI.runCommand(`wsl bash -c "echo ${b64} | base64 -d | bash"`, {
      timeout: 30000,
    });
    return {
      success: result.success,
      error: result.success ? undefined : result.stderr || result.stdout || "Failed to write Hermes file",
    };
  }

  const b64 = encodeScript(content);
  const result = await runHermesShell(
    [
      `TARGET="${targetPath}"`,
      'mkdir -p "$(dirname "$TARGET")"',
      `echo ${b64} | base64 -d > "$TARGET"`,
      ...(mode ? [`chmod ${mode} "$TARGET" || true`] : []),
    ].join("\n"),
    { timeout: 30000 },
  );

  return {
    success: result.success,
    error: result.success ? undefined : result.stderr || result.stdout || "Failed to write Hermes file",
  };
};
