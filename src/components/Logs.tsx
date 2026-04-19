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
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm font-medium">
        <Terminal className="size-4 text-accent" />
        <span>Live logs</span>
        <span className="ml-auto text-xs text-muted-foreground">{lines.length} lines</span>
      </div>
      <div
        ref={ref}
        className="h-64 overflow-auto p-3 font-mono text-xs leading-relaxed text-muted-foreground"
      >
        {lines.length === 0 && <div className="opacity-60">Waiting for run…</div>}
        {lines.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap">
            <span className="text-accent/70">›</span> {l}
          </div>
        ))}
      </div>
    </div>
  );
}
