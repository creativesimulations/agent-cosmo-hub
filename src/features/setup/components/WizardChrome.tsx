import { cn } from "@/lib/utils";
import { WIZARD_STEPS } from "@/features/setup/constants";
import type { WizardStep } from "@/features/setup/types";

type Props = {
  step: WizardStep;
  onBack: () => void;
  canGoBack: boolean;
  children: React.ReactNode;
};

export function WizardChrome({ step, onBack, canGoBack, children }: Props) {
  const index = WIZARD_STEPS.findIndex((s) => s.id === step);

  return (
    <div className="max-w-lg w-full space-y-6">
      {canGoBack && (
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </button>
      )}
      <ol className="flex gap-2">
        {WIZARD_STEPS.map((s, i) => (
          <li
            key={s.id}
            className={cn("flex-1 h-1 rounded-full", i <= index ? "bg-primary" : "bg-muted")}
            title={s.title}
          />
        ))}
      </ol>
      <header>
        <h2 className="text-lg font-semibold">{WIZARD_STEPS[index]?.title}</h2>
        <p className="text-xs text-muted-foreground">{WIZARD_STEPS[index]?.desc}</p>
      </header>
      {children}
    </div>
  );
}
