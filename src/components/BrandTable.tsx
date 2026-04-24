import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSearch,
  Loader2,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { guideFilename } from "@/lib/normalizers/guideBuilder";
import { mapRequestedGarmentCategory, mapRequestedSizeSystem } from "@/lib/ingestion/taxonomy";
import type { BrandResult } from "@/lib/types";

interface Props {
  results: BrandResult[];
  onPreview: (index: number) => void;
}

const statusMeta: Record<
  BrandResult["status"],
  { label: string; icon: ReactNode; cls: string }
> = {
  pending: {
    label: "Pending",
    icon: <Clock className="size-3" />,
    cls: "border-border bg-muted text-muted-foreground",
  },
  running: {
    label: "Running",
    icon: <Loader2 className="size-3 animate-spin" />,
    cls: "border-info/25 bg-info/10 text-info",
  },
  done: {
    label: "Accepted",
    icon: <CheckCircle2 className="size-3" />,
    cls: "border-success/25 bg-success/10 text-success",
  },
  review: {
    label: "Review",
    icon: <AlertTriangle className="size-3" />,
    cls: "border-warning/35 bg-warning/15 text-warning-foreground",
  },
  error: {
    label: "Rejected",
    icon: <XCircle className="size-3" />,
    cls: "border-destructive/25 bg-destructive/10 text-destructive",
  },
};

function requestedCategoryLabel(result: BrandResult): string {
  return mapRequestedGarmentCategory(result.source.garmentCategory) ?? "—";
}

function requestedSizeSystemLabel(result: BrandResult): string {
  return mapRequestedSizeSystem(result.source.sizeSystem) ?? "—";
}

function summaryMessage(result: BrandResult): string {
  if (result.message) return result.message;
  const selectedId = result.pipeline?.selectedCandidateId;
  if (selectedId) {
    const selected = result.pipeline?.discoveredCandidates.find(
      (candidate) => candidate.id === selectedId,
    );
    if (selected) {
      const followed = result.pipeline?.followedUrl ? " · followed link" : "";
      return `${selected.sectionTitle} · ${selected.matrixOrientation} · ${result.pipeline?.validationStatus}${followed}`;
    }
  }
  if (result.pipeline?.documentReasoning.length) {
    return result.pipeline.documentReasoning[0] ?? "—";
  }
  return "—";
}

export function BrandTable({ results, onPreview }: Props) {
  function downloadOne(result: BrandResult) {
    if (!result.guide) return;
    const blob = new Blob([JSON.stringify(result.guide.strictGuide, null, 2)], {
      type: "application/json",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = guideFilename(result.guide);
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-panel)]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-normal">Brand queue</h2>
          <p className="text-xs text-muted-foreground">
            {results.length ? `${results.length} sources loaded` : "No sources loaded"}
          </p>
        </div>
      </div>
      <Table className="min-w-[860px]">
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="h-11 px-4 text-xs uppercase tracking-normal text-muted-foreground">
              Brand
            </TableHead>
            <TableHead className="h-11 px-4 text-xs uppercase tracking-normal text-muted-foreground">
              Requested
            </TableHead>
            <TableHead className="h-11 px-4 text-xs uppercase tracking-normal text-muted-foreground">
              Status
            </TableHead>
            <TableHead className="h-11 px-4 text-xs uppercase tracking-normal text-muted-foreground">
              Rows
            </TableHead>
            <TableHead className="h-11 px-4 text-xs uppercase tracking-normal text-muted-foreground">
              Selection / Validation
            </TableHead>
            <TableHead className="h-11 px-4 text-right text-xs uppercase tracking-normal text-muted-foreground">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((result, index) => {
            const meta = statusMeta[result.status];
            return (
              <TableRow
                key={`${result.source.brand}-${index}`}
                className="border-border hover:bg-surface/70"
              >
                <TableCell className="px-4 py-3 font-medium">{result.source.brand}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {requestedCategoryLabel(result)} / {requestedSizeSystemLabel(result)}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <Badge className={`gap-1 shadow-none ${meta.cls}`}>
                    {meta.icon}
                    {meta.label}
                  </Badge>
                </TableCell>
                <TableCell className="px-4 py-3">{result.rowsCount ?? "—"}</TableCell>
                <TableCell
                  className="max-w-[360px] truncate px-4 py-3 text-xs text-muted-foreground"
                  title={summaryMessage(result)}
                >
                  {summaryMessage(result)}
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  {(result.pipeline || result.guide) && (
                    <div className="flex justify-end gap-1">
                      <Button
                        aria-label={`Preview ${result.source.brand}`}
                        title="Preview"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        onClick={() => onPreview(index)}
                      >
                        <Eye />
                      </Button>
                      {result.guide && (
                        <Button
                          aria-label={`Download ${result.source.brand}`}
                          title="Download"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() => downloadOne(result)}
                        >
                          <Download />
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {!results.length && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="px-4 py-10 text-center text-muted-foreground"
              >
                <div className="flex flex-col items-center gap-2">
                  <FileSearch className="size-5 text-muted-foreground/70" />
                  <span>No brands loaded yet.</span>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
