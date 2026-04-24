import { useState } from "react";
import JSZip from "jszip";
import { Download, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BrandResult } from "@/lib/types";
import { guideFilename } from "@/lib/normalizers/guideBuilder";

interface Props {
  results: BrandResult[];
}

export function DownloadAll({ results }: Props) {
  const [busy, setBusy] = useState(false);
  const ready = results.filter((r) => r.guide);

  async function downloadZip() {
    if (!ready.length) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder("generated-guides");
      for (const r of ready) {
        if (!r.guide) continue;
        folder!.file(guideFilename(r.guide), JSON.stringify(r.guide.strictGuide, null, 2));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "generated-guides.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      onClick={downloadZip}
      disabled={!ready.length || busy}
      variant="outline"
      className="w-full bg-card shadow-sm hover:bg-surface hover:text-foreground sm:w-auto"
    >
      {busy ? <Package className="animate-pulse" /> : <Download />}
      Download ZIP ({ready.length})
    </Button>
  );
}
