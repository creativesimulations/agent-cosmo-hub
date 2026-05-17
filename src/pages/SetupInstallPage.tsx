// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useSetup } from "@/contexts/SetupContext";
import { SetupHub } from "@/features/setup/components/SetupHub";
import { ConnectPanel } from "@/features/setup/components/ConnectPanel";
import { ExistingInstallGuard } from "@/features/setup/components/ExistingInstallGuard";
import { WizardChrome } from "@/features/setup/components/WizardChrome";
import { PrereqsStep } from "@/features/setup/components/PrereqsStep";
import { InstallStep } from "@/features/setup/components/InstallStep";
import { DoneStep } from "@/features/setup/components/DoneStep";

export default function SetupInstallPage() {
  const navigate = useNavigate();
  const setup = useSetup();
  const [connecting, setConnecting] = useState(false);
  const [preflightReady, setPreflightReady] = useState(false);

  const goHomeOnConnect = async (connect: () => Promise<boolean>) => {
    setConnecting(true);
    const ok = await connect();
    setConnecting(false);
    if (ok) navigate("/");
  };

  const wizardBack = () => {
    if (setup.wizardStep === "install" && !setup.installing) {
      setup.setWizardStep("prereqs");
      return;
    }
    if (setup.wizardStep === "prereqs") {
      setup.goHub();
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center min-h-screen p-8">
      <AnimatePresence mode="wait">
        {setup.phase === "hub" && (
          <motion.div key="hub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SetupHub
              busy={setup.busy}
              onConnect={setup.goConnect}
              onInstall={() => void setup.startBundledInstall()}
              onLocalFolder={() => void setup.pickLocalFolder()}
            />
          </motion.div>
        )}

        {setup.phase === "connect" && (
          <motion.div key="connect" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <ConnectPanel
              connecting={connecting}
              onBack={setup.goHub}
              onConnect={() => goHomeOnConnect(setup.finishConnect)}
            />
          </motion.div>
        )}

        {setup.phase === "guard" && setup.guardAgentName && (
          <motion.div key="guard" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <ExistingInstallGuard
              agentName={setup.guardAgentName}
              onBack={setup.goHub}
              onConnect={() => goHomeOnConnect(setup.guardConnect)}
              onRename={async (name) => {
                const ok = await setup.guardRename(name);
                if (ok) navigate("/");
                return ok;
              }}
              onReset={setup.guardResetAndReinstall}
            />
          </motion.div>
        )}

        {setup.phase === "wizard" && (
          <motion.div key="wizard" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <WizardChrome
              step={setup.wizardStep}
              canGoBack={!setup.installing}
              onBack={wizardBack}
            >
              {setup.wizardStep === "prereqs" && (
                <PrereqsStep
                  onContinue={() => setup.setWizardStep("install")}
                  onConnectExisting={async () => {
                    const ok = await setup.finishConnect();
                    if (ok) navigate("/");
                  }}
                />
              )}
              {setup.wizardStep === "install" && (
                <InstallStep
                  source={setup.installSource}
                  localPath={setup.localPath}
                  replacePersona={setup.replacePersona}
                  onReplacePersonaChange={setup.setReplacePersona}
                  installing={setup.installing}
                  progress={setup.installProgress}
                  logLines={setup.logLines}
                  preflightReady={preflightReady}
                  onPreflightReady={setPreflightReady}
                  onInstall={() => void setup.runInstall()}
                  onCancel={setup.cancelInstall}
                />
              )}
              {setup.wizardStep === "done" && <DoneStep onOpenHome={() => navigate("/")} />}
            </WizardChrome>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

