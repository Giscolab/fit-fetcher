import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
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
    cls: "bg-muted text-muted-foreground",
  },
  running: {
    label: "Running",
    icon: <Loader2 className="size-3 animate-spin" />,
    cls: "bg-accent/20 text-accent",
  },
  done: {
    label: "Accepted",
    icon: <CheckCircle2 className="size-3" />,
    cls: "bg-accent text-accent-foreground",
  },
  review: {
    label: "Review",
    icon: <AlertTriangle className="size-3" />,
    cls: "bg-amber-500/15 text-amber-600",
  },
  error: {
    label: "Rejected",
    icon: <XCircle className="size-3" />,
    cls: "bg-destructive text-destructive-foreground",
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
    if (selected) return `${selected.sectionTitle} · ${result.pipeline?.validationStatus}`;
  }
  return "—";
}

export function BrandTable({ results, onPreview }: Props) {
  function downloadOne(result: BrandResult) {
    if (!result.guide) return;
    const blob = new Blob([JSON.stringify(result.guide, null, 2)], {
      type: "application/json",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = guideFilename(result.guide);
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground">Brand</TableHead>
            <TableHead className="text-muted-foreground">Requested</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="text-muted-foreground">Rows</TableHead>
            <TableHead className="text-muted-foreground">Selection / Validation</TableHead>
            <TableHead className="text-right text-muted-foreground">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((result, index) => {
            const meta = statusMeta[result.status];
            return (
              <TableRow
                key={`${result.source.brand}-${index}`}
                className="border-border"
              >
                <TableCell className="font-medium">{result.source.brand}</TableCell>
                <TableCell className="text-muted-foreground">
                  {requestedCategoryLabel(result)} / {requestedSizeSystemLabel(result)}
                </TableCell>
                <TableCell>
                  <Badge className={`gap-1 ${meta.cls}`}>
                    {meta.icon}
                    {meta.label}
                  </Badge>
                </TableCell>
                <TableCell>{result.rowsCount ?? "—"}</TableCell>
                <TableCell
                  className="max-w-[360px] truncate text-xs text-muted-foreground"
                  title={summaryMessage(result)}
                >
                  {summaryMessage(result)}
                </TableCell>
                <TableCell className="text-right">
                  {(result.pipeline || result.guide) && (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onPreview(index)}
                      >
                        <Eye />
                      </Button>
                      {result.guide && (
                        <Button
                          size="sm"
                          variant="ghost"
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
                className="py-8 text-center text-muted-foreground"
              >
                No brands loaded yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
