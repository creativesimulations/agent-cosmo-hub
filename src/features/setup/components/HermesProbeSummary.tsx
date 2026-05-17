import type { HermesInstallProbe } from "@/lib/systemAPI/hermes/installProbe";
import { formatHermesInstallProbe } from "@/lib/systemAPI/hermes/installProbe";

type Props = {
  state: HermesInstallProbe;
  className?: string;
};

export function HermesProbeSummary({ state, className }: Props) {
  return (
    <ul className={className ?? "text-xs font-mono text-muted-foreground space-y-0.5"}>
      {formatHermesInstallProbe(state).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
