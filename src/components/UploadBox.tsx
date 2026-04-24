import { useRef, useState } from "react";
import { Upload, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { BrandSource } from "@/lib/types";

interface Props {
  onLoaded: (sources: BrandSource[], filename: string) => void;
}

/**
 * Accepts both schemas:
 *   Legacy: { brand, size_guide_url, garmentCategory?, sizeSystem? }
 *   Simplified: { brand, entry_url, target?: { category, sizeSystem, gender } }
 * Unknown-shaped entries are skipped and surfaced in the "skipped" counter.
 */
function normalizeSource(raw: unknown): BrandSource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const brand = typeof r.brand === "string" ? r.brand : typeof r.name === "string" ? r.name : null;
  if (!brand) return null;

  const url =
    typeof r.size_guide_url === "string"
      ? r.size_guide_url
      : typeof r.entry_url === "string"
        ? r.entry_url
        : typeof r.url === "string"
          ? r.url
          : null;
  if (!url) return null;

  const target = (r.target && typeof r.target === "object")
    ? (r.target as Record<string, unknown>)
    : null;

  const garmentCategory =
    typeof r.garmentCategory === "string"
      ? r.garmentCategory
      : target && typeof target.category === "string"
        ? (target.category as string)
        : undefined;

  const sizeSystem =
    typeof r.sizeSystem === "string"
      ? r.sizeSystem
      : target && typeof target.sizeSystem === "string"
        ? (target.sizeSystem as string)
        : undefined;

  const genderRaw =
    typeof r.gender === "string"
      ? r.gender
      : target && typeof target.gender === "string"
        ? (target.gender as string)
        : undefined;

  const gender: BrandSource["gender"] | undefined =
    genderRaw === "men" || genderRaw === "women" || genderRaw === "kids" || genderRaw === "unisex"
      ? genderRaw
      : undefined;

  return {
    brand,
    size_guide_url: url,
    garmentCategory,
    sizeSystem,
    gender,
  };
}

export function UploadBox({ onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<number>(0);

  function handleFile(file: File) {
    setError(null);
    setSkipped(0);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const rows: unknown = parsed?.sources ?? parsed;
        if (!Array.isArray(rows)) {
          throw new Error("Expected an array under `sources` (or at the root).");
        }
        const normalized: BrandSource[] = [];
        let rejected = 0;
        for (const row of rows) {
          const ok = normalizeSource(row);
          if (ok) normalized.push(ok);
          else rejected += 1;
        }
        if (!normalized.length) {
          throw new Error(
            "No valid sources found. Each entry needs a brand and either `size_guide_url` or `entry_url`.",
          );
        }
        setFilename(file.name);
        setSkipped(rejected);
        onLoaded(normalized, file.name);
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
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">Drop your brands.json</h3>
          <p className="text-sm text-muted-foreground">
            Accepted:{" "}
            <code>{"{ brand, entry_url, target: { category, sizeSystem, gender } }"}</code>
          </p>
          <p className="text-xs text-muted-foreground">
            Legacy <code>size_guide_url</code> + flat fields still works.
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
          <p className="text-xs text-muted-foreground">
            Loaded: {filename}
            {skipped > 0 ? ` · ${skipped} row(s) skipped (missing brand or URL)` : ""}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Card>
  );
}
