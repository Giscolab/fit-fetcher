import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";

interface Props {
  lines: string[];
}

export function Logs({ lines }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-panel)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium">
        <Terminal className="size-4 text-primary" />
        <span>Journal d'exécution</span>
        <span className="ml-auto text-xs text-muted-foreground">{lines.length} ligne(s)</span>
      </div>
      <div
        ref={ref}
        className="h-80 overflow-auto bg-surface/70 p-3 font-mono text-xs leading-relaxed text-surface-foreground"
      >
        {lines.length === 0 && <div className="opacity-60">En attente d'une exécution…</div>}
        {lines.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap">
            <span className="text-primary">›</span> {l}
          </div>
        ))}
      </div>
    </div>
  );
}
