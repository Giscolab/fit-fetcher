import { CheckCircle2, Clock, Loader2, XCircle, Eye, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BrandResult } from "@/lib/types";
import { guideFilename } from "@/lib/normalizers/guideBuilder";

interface Props {
  results: BrandResult[];
  onPreview: (index: number) => void;
}

const statusMeta: Record<
  BrandResult["status"],
  { label: string; icon: React.ReactNode; cls: string }
> = {
  pending: { label: "Pending", icon: <Clock className="size-3" />, cls: "bg-muted text-muted-foreground" },
  running: { label: "Running", icon: <Loader2 className="size-3 animate-spin" />, cls: "bg-accent/20 text-accent" },
  done: { label: "Done", icon: <CheckCircle2 className="size-3" />, cls: "bg-accent text-accent-foreground" },
  error: { label: "Error", icon: <XCircle className="size-3" />, cls: "bg-destructive text-destructive-foreground" },
};

export function BrandTable({ results, onPreview }: Props) {
  function downloadOne(r: BrandResult) {
    if (!r.guide) return;
    const blob = new Blob([JSON.stringify(r.guide, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = guideFilename(r.guide);
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground">Brand</TableHead>
            <TableHead className="text-muted-foreground">Category / System</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="text-muted-foreground">Rows</TableHead>
            <TableHead className="text-muted-foreground">Message</TableHead>
            <TableHead className="text-right text-muted-foreground">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r, i) => {
            const meta = statusMeta[r.status];
            return (
              <TableRow key={`${r.source.brand}-${i}`} className="border-border">
                <TableCell className="font-medium">{r.source.brand}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.source.garmentCategory ?? "tshirts"} / {r.source.sizeSystem ?? "INT"}
                </TableCell>
                <TableCell>
                  <Badge className={`gap-1 ${meta.cls}`}>{meta.icon} {meta.label}</Badge>
                </TableCell>
                <TableCell>{r.rowsCount ?? "—"}</TableCell>
                <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={r.message}>
                  {r.message ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {r.guide && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onPreview(i)}>
                        <Eye />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => downloadOne(r)}>
                        <Download />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {!results.length && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                No brands loaded yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
