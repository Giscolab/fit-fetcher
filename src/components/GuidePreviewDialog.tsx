import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BrandResult, SizeRow } from "@/lib/types";
import { guideFilename } from "@/lib/normalizers/guideBuilder";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: BrandResult | null;
}

const MEASURE_COLS: Array<{
  label: string;
  min: keyof SizeRow;
  max: keyof SizeRow;
}> = [
  { label: "Chest", min: "chestCmMin", max: "chestCmMax" },
  { label: "Waist", min: "waistCmMin", max: "waistCmMax" },
  { label: "Hips", min: "hipsCmMin", max: "hipsCmMax" },
  { label: "Inseam", min: "inseamCmMin", max: "inseamCmMax" },
  { label: "Neck", min: "neckCmMin", max: "neckCmMax" },
  { label: "Shoulder", min: "shoulderCmMin", max: "shoulderCmMax" },
  { label: "Sleeve", min: "sleeveCmMin", max: "sleeveCmMax" },
  { label: "Foot", min: "footCmMin", max: "footCmMax" },
];

function fmt(row: SizeRow, min: keyof SizeRow, max: keyof SizeRow): string {
  const a = row[min] as number | undefined;
  const b = row[max] as number | undefined;
  if (a == null && b == null) return "—";
  if (a === b || b == null) return `${a}`;
  if (a == null) return `${b}`;
  return a === b ? `${a}` : `${a}–${b}`;
}

export function GuidePreviewDialog({ open, onOpenChange, result }: Props) {
  const guide = result?.guide;
  if (!guide) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No guide</DialogTitle>
            <DialogDescription>This brand has no generated guide yet.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  // Only show columns that have data
  const visibleCols = MEASURE_COLS.filter((c) =>
    guide.guide.rows.some((r) => r[c.min] != null || r[c.max] != null),
  );

  function downloadOne() {
    if (!guide) return;
    const blob = new Blob([JSON.stringify(guide, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = guideFilename(guide);
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{guide.guide.name}</DialogTitle>
          <DialogDescription>
            {guide.brand.name} · {guide.guide.garmentCategory} · {guide.guide.sizeSystem} ·{" "}
            {guide.guide.rows.length} rows
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto rounded border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Size</TableHead>
                {visibleCols.map((c) => (
                  <TableHead key={c.label}>{c.label} (cm)</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {guide.guide.rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  {visibleCols.map((c) => (
                    <TableCell key={c.label} className="text-muted-foreground">
                      {fmt(r, c.min, c.max)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={downloadOne}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Download /> Download this guide
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
