import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Play, Pause, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UploadBox } from "@/components/UploadBox";
import { BrandTable } from "@/components/BrandTable";
import { Logs } from "@/components/Logs";
import { DownloadAll } from "@/components/DownloadAll";
import { GuidePreviewDialog } from "@/components/GuidePreviewDialog";
import { scrapeBrandSource } from "@/lib/server/scrape.functions";
import type { BrandResult, BrandSource } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Size Intelligence Visual Scraper" },
      {
        name: "description",
        content:
          "Upload a brands catalog, scrape size guides via Firecrawl, normalize and download importable JSON.",
      },
      { property: "og:title", content: "Size Intelligence Visual Scraper" },
      {
        property: "og:description",
        content:
          "Upload a brands catalog, scrape size guides via Firecrawl, normalize and download importable JSON.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const [results, setResults] = useState<BrandResult[]>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  function pushLog(line: string) {
    setLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] ${line}`]);
  }

  function handleLoaded(sources: BrandSource[], name: string) {
    setFilename(name);
    setResults(sources.map((s) => ({ source: s, status: "pending", logs: [] })));
    setLogs([`Loaded ${sources.length} brand sources from ${name}`]);
  }

  async function runAll() {
    if (!results.length || running) return;
    setRunning(true);
    pushLog(`Starting scrape for ${results.length} brands…`);

    for (let i = 0; i < results.length; i++) {
      setResults((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: "running", message: undefined };
        return next;
      });
      const src = results[i].source;
      pushLog(`→ [${i + 1}/${results.length}] ${src.brand}`);
      try {
        const res = await scrapeBrandSource({ data: { source: src } });
        for (const l of res.logs) pushLog(`   ${l}`);
        setResults((prev) => {
          const next = [...prev];
          if (res.guide) {
            next[i] = {
              ...next[i],
              status: "done",
              guide: res.guide,
              rowsCount: res.guide.guide.rows.length,
              message: res.meta
                ? `${res.meta.strategy} · ${res.meta.unit}`
                : "ok",
              logs: res.logs,
            };
          } else {
            next[i] = {
              ...next[i],
              status: "error",
              message: res.error ?? "Unknown error",
              logs: res.logs,
            };
          }
          return next;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushLog(`   ERROR: ${message}`);
        setResults((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: "error", message, logs: [message] };
          return next;
        });
      }
      // gentle throttle
      await new Promise((r) => setTimeout(r, 400));
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
                Firecrawl-powered · multi-heuristic extraction
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DownloadAll results={results} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <UploadBox onLoaded={handleLoaded} />

        <Card className="flex flex-col gap-4 border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Run scraping pipeline</h2>
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

        <BrandTable results={results} onPreview={(i) => setPreviewIndex(i)} />

        <Logs lines={logs} />

        <GuidePreviewDialog
          open={previewIndex !== null}
          onOpenChange={(o) => !o && setPreviewIndex(null)}
          result={previewIndex !== null ? results[previewIndex] : null}
        />
      </main>
    </div>
  );
}
