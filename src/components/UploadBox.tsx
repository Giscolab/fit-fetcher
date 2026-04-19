import { useRef, useState } from "react";
import { Upload, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
        if (!Array.isArray(sources)) throw new Error("Expected an array under `sources`");
        const valid = (sources as BrandSource[]).filter(
          (s) => s && typeof s.brand === "string" && typeof s.size_guide_url === "string",
        );
        if (!valid.length) throw new Error("No valid sources found");
        setFilename(file.name);
        onLoaded(valid, file.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid JSON");
      }
    };
    reader.readAsText(file);
  }

  return (
    <Card
      className="border-dashed border-2 border-border bg-card/50 p-10 text-center transition-colors hover:border-accent"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      }}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-full bg-accent/10 p-4">
          <Upload className="size-8 text-accent" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Drop your brands.json</h3>
          <p className="text-sm text-muted-foreground">
            Format: <code>{"{ sources: [{ brand, size_guide_url, garmentCategory, sizeSystem }] }"}</code>
          </p>
        </div>
        <Button
          variant="default"
          onClick={() => inputRef.current?.click()}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
        >
          <FileJson /> Choose file
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
          <p className="text-xs text-muted-foreground">Loaded: {filename}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Card>
  );
}
