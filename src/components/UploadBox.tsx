import { useRef, useState } from "react";
import { Upload, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { normalizeBrandSourceInput } from "@/lib/normalizers/sourceInput";
import type { BrandSource } from "@/lib/types";

interface Props {
  onLoaded: (sources: BrandSource[], filename: string) => void;
}

export function UploadBox({ onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const sources: unknown = parsed.sources ?? parsed;
        if (!Array.isArray(sources)) throw new Error("Un tableau est attendu dans `sources`");
        const valid = sources.map(normalizeBrandSourceInput).filter(Boolean) as BrandSource[];
        if (!valid.length) throw new Error("Aucune source valide trouvée");
        setFilename(file.name);
        onLoaded(valid, file.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "JSON invalide");
      }
    };
    reader.readAsText(file);
  }

  return (
    <Card
      className="flex h-full min-h-[260px] border-2 border-dashed border-border bg-card p-5 text-center shadow-[var(--shadow-panel)] transition-colors hover:border-primary/60"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      }}
    >
      <div className="flex w-full flex-col items-center justify-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Upload className="size-6" />
        </div>
        <div className="max-w-sm">
          <h3 className="text-base font-semibold tracking-normal">Déposez votre fichier brands.json</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Format:{" "}
            <code className="break-words rounded bg-muted px-1.5 py-0.5 text-[0.72rem] text-foreground">
              {"{ sources: [{ brand, entry_url, target: { category, sizeSystem } }] }"}
            </code>
          </p>
        </div>
        <Button
          variant="default"
          onClick={() => inputRef.current?.click()}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <FileJson /> Choisir un fichier
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {filename && (
          <p className="rounded-md bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            Chargé: {filename}
          </p>
        )}
        {error && (
          <p className="rounded-md bg-destructive/10 px-2.5 py-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
