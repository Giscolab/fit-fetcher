import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pause, Play, Sparkles } from "lucide-react";
import { BrandTable } from "@/components/BrandTable";
import { DownloadAll } from "@/components/DownloadAll";
import { GuidePreviewDialog } from "@/components/GuidePreviewDialog";
import { Logs } from "@/components/Logs";
import { UploadBox } from "@/components/UploadBox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  scrapeBrandSource,
  type ScrapeResponse,
} from "@/lib/server/scrape.functions";
import type { BrandResult, BrandSource } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Size Intelligence Visual Scraper" },
      {
        name: "description",
        content:
          "Upload a brands catalog, discover size-guide sections, validate extractions, and export traceable JSON.",
      },
      { property: "og:title", content: "Size Intelligence Visual Scraper" },
      {
        property: "og:description",
        content:
          "Upload a brands catalog, discover size-guide sections, validate extractions, and export traceable JSON.",
      },
    ],
  }),
  component: HomePage,
});

function summarizeRun(result: ScrapeResponse) {
  if (result.guide) {
    return `${result.guide.guide.sourceSectionTitle} · ${result.guide.guide.validationStatus}`;
  }
  return (
    result.pipeline.validationErrors[0]?.message ??
    result.pipeline.selectionReasoning[0] ??
    "No validated guide was generated."
  );
}

function deriveStatus(result: ScrapeResponse): BrandResult["status"] {
  if (result.guide) return "done";
  if (result.pipeline.manualReviewRecommended && result.pipeline.discoveredCandidates.length > 0) {
    return "review";
  }
  return "error";
}

function HomePage() {
  const [results, setResults] = useState<BrandResult[]>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  function pushLog(line: string) {
    setLogs((lines) => [...lines, `[${new Date().toLocaleTimeString()}] ${line}`]);
  }

  function handleLoaded(sources: BrandSource[], name: string) {
    setFilename(name);
    setResults(sources.map((source) => ({ source, status: "pending", logs: [] })));
    setLogs([`Loaded ${sources.length} brand sources from ${name}`]);
  }

  async function runAll() {
    if (!results.length || running) return;
    setRunning(true);
    pushLog(`Starting ingestion for ${results.length} brands…`);

    for (let i = 0; i < results.length; i++) {
      setResults((previous) => {
        const next = [...previous];
        next[i] = { ...next[i], status: "running", message: undefined };
        return next;
      });

      const source = results[i].source;
      pushLog(`→ [${i + 1}/${results.length}] ${source.brand}`);

      try {
        const response = await scrapeBrandSource({ data: { source } });
        for (const line of response.logs) pushLog(`   ${line}`);

        setResults((previous) => {
          const next = [...previous];
          next[i] = {
            ...next[i],
            status: deriveStatus(response),
            guide: response.guide,
            pipeline: response.pipeline,
            rowsCount:
              response.guide?.guide.rows.length ??
              response.pipeline.candidateExtractions[0]?.rows.length,
            message: summarizeRun(response),
            logs: response.logs,
          };
          return next;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushLog(`   ERROR: ${message}`);
        setResults((previous) => {
          const next = [...previous];
          next[i] = { ...next[i], status: "error", message, logs: [message] };
          return next;
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    pushLog("Run finished.");
    setRunning(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-accent p-2 text-accent-foreground">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Size Intelligence Scraper
              </h1>
              <p className="text-xs text-muted-foreground">
                Candidate discovery · constrained extraction · strict validation
              </p>
            </div>
          </div>
          <DownloadAll results={results} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <UploadBox onLoaded={handleLoaded} />

        <Card className="flex flex-col gap-4 border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Run ingestion pipeline</h2>
            <p className="text-sm text-muted-foreground">
              {filename
                ? `${results.length} brands ready from ${filename}`
                : "Upload a brands.json file to get started."}
            </p>
          </div>
          <Button
            onClick={runAll}
            disabled={!results.length || running}
            size="lg"
            className="bg-accent text-accent-foreground hover:bg-accent/90"
            style={{ boxShadow: "var(--shadow-glow)" }}
          >
            {running ? <Pause /> : <Play />}
            {running ? "Running…" : "Start scraping"}
          </Button>
        </Card>

        <BrandTable results={results} onPreview={(index) => setPreviewIndex(index)} />

        <Logs lines={logs} />

        <GuidePreviewDialog
          open={previewIndex !== null}
          onOpenChange={(open) => !open && setPreviewIndex(null)}
          result={previewIndex !== null ? results[previewIndex] : null}
        />
      </main>
    </div>
  );
}
