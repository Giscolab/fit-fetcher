import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  Sparkles,
  XCircle,
} from "lucide-react";
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

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "destructive";
}) {
  const toneClass = {
    neutral: "border-border bg-card text-foreground",
    success: "border-success/25 bg-success/10 text-success",
    warning: "border-warning/35 bg-warning/15 text-warning-foreground",
    destructive: "border-destructive/25 bg-destructive/10 text-destructive",
  }[tone];

  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <div className="text-[0.7rem] font-medium uppercase tracking-normal opacity-75">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold leading-none">{value}</div>
    </div>
  );
}

function HomePage() {
  const [results, setResults] = useState<BrandResult[]>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const acceptedCount = results.filter((result) => result.status === "done").length;
  const reviewCount = results.filter((result) => result.status === "review").length;
  const errorCount = results.filter((result) => result.status === "error").length;
  const pendingCount = results.filter(
    (result) => result.status === "pending" || result.status === "running",
  ).length;

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
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-normal">
                Size Intelligence Scraper
              </h1>
              <p className="text-xs text-muted-foreground">
                Candidate discovery · constrained extraction · strict validation
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatPill label="Queued" value={pendingCount} tone="neutral" />
              <StatPill label="Accepted" value={acceptedCount} tone="success" />
              <StatPill label="Review" value={reviewCount} tone="warning" />
              <StatPill label="Rejected" value={errorCount} tone="destructive" />
            </div>
            <DownloadAll results={results} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <section className="grid gap-5 lg:grid-cols-[minmax(280px,420px)_1fr]">
          <UploadBox onLoaded={handleLoaded} />

          <Card className="border-border bg-card p-5 shadow-[var(--shadow-panel)]">
            <div className="flex h-full flex-col justify-between gap-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <div className="flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Activity className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-normal">
                      Run ingestion pipeline
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {filename
                        ? `${results.length} brands ready from ${filename}`
                        : "Upload a brands.json file to get started."}
                    </p>
                  </div>
                </div>
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-surface-foreground">
                  {running ? "In progress" : results.length ? "Ready" : "Idle"}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-border bg-background p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    Pending
                  </div>
                  <div className="mt-2 text-xl font-semibold">{pendingCount}</div>
                </div>
                <div className="rounded-md border border-success/25 bg-success/10 p-3">
                  <div className="flex items-center gap-2 text-xs text-success">
                    <CheckCircle2 className="size-3.5" />
                    Accepted
                  </div>
                  <div className="mt-2 text-xl font-semibold text-success">{acceptedCount}</div>
                </div>
                <div className="rounded-md border border-warning/35 bg-warning/15 p-3">
                  <div className="flex items-center gap-2 text-xs text-warning-foreground">
                    <AlertTriangle className="size-3.5" />
                    Review
                  </div>
                  <div className="mt-2 text-xl font-semibold text-warning-foreground">
                    {reviewCount}
                  </div>
                </div>
                <div className="rounded-md border border-destructive/25 bg-destructive/10 p-3">
                  <div className="flex items-center gap-2 text-xs text-destructive">
                    <XCircle className="size-3.5" />
                    Rejected
                  </div>
                  <div className="mt-2 text-xl font-semibold text-destructive">{errorCount}</div>
                </div>
              </div>

              <Button
                onClick={runAll}
                disabled={!results.length || running}
                size="lg"
                className="h-11 w-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 sm:w-fit"
                style={{ boxShadow: results.length ? "var(--shadow-glow)" : undefined }}
              >
                {running ? <Pause /> : <Play />}
                {running ? "Running…" : "Start scraping"}
              </Button>
            </div>
          </Card>
        </section>

        <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <BrandTable results={results} onPreview={(index) => setPreviewIndex(index)} />
          <Logs lines={logs} />
        </section>

        <GuidePreviewDialog
          open={previewIndex !== null}
          onOpenChange={(open) => !open && setPreviewIndex(null)}
          result={previewIndex !== null ? results[previewIndex] : null}
        />
      </main>
    </div>
  );
}
