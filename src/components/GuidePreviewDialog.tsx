import { Download, ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { guideFilename } from "@/lib/normalizers/guideBuilder";
import { mapRequestedGarmentCategory, mapRequestedSizeSystem } from "@/lib/ingestion/taxonomy";
import type {
  BrandResult,
  CandidateSection,
  LinkCandidate,
  SizeRow,
  SourceTraceStep,
  ValidationIssue,
} from "@/lib/types";

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
  { label: "Outseam", min: "outseamCmMin", max: "outseamCmMax" },
  { label: "Height", min: "heightCmMin", max: "heightCmMax" },
  { label: "Neck", min: "neckCmMin", max: "neckCmMax" },
  { label: "Shoulder", min: "shoulderCmMin", max: "shoulderCmMax" },
  { label: "Sleeve", min: "sleeveCmMin", max: "sleeveCmMax" },
  { label: "Foot L.", min: "footLengthCmMin", max: "footLengthCmMax" },
  { label: "Foot W.", min: "footWidthCmMin", max: "footWidthCmMax" },
];

function fmt(row: SizeRow, min: keyof SizeRow, max: keyof SizeRow): string {
  const a = row[min] as number | undefined;
  const b = row[max] as number | undefined;
  if (a == null && b == null) return "—";
  if (a === b || b == null) return `${a}`;
  if (a == null) return `${b}`;
  return `${a}–${b}`;
}

function IssueList({
  title,
  issues,
  destructive = false,
}: {
  title: string;
  issues: ValidationIssue[];
  destructive?: boolean;
}) {
  if (!issues.length) return null;
  return (
    <Alert variant={destructive ? "destructive" : "default"}>
      {destructive ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-2">
        {issues.map((issue, index) => (
          <p key={`${issue.code}-${index}`}>{issue.message}</p>
        ))}
      </AlertDescription>
    </Alert>
  );
}

function TraceChain({ steps }: { steps: SourceTraceStep[] }) {
  if (!steps.length) return null;

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <h3 className="text-sm font-semibold">Source trace</h3>
      <div className="mt-3 space-y-3 text-sm">
        {steps.map((step, index) => (
          <div key={`${step.url}-${index}`} className="rounded border border-border/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{step.kind}</Badge>
              <span className="font-medium">{step.label}</span>
              <span className="text-xs text-muted-foreground">
                confidence {step.confidence.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 break-all text-xs text-muted-foreground">{step.url}</div>
            {!!step.reasons.length && (
              <div className="mt-2 text-xs text-muted-foreground">
                {step.reasons.slice(0, 3).join(" ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LinkCandidateCard({ candidate }: { candidate: LinkCandidate }) {
  return (
    <div
      className={`space-y-3 rounded-lg border p-4 ${
        candidate.selected ? "border-accent bg-accent/5" : "border-border bg-background"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{candidate.label}</h3>
        <Badge variant="outline">{candidate.detectedCategory}</Badge>
        <Badge variant="outline">{candidate.detectedSizeSystem}</Badge>
        <Badge variant="outline">{candidate.categoryMappingMode}</Badge>
        {candidate.selected && <Badge className="bg-accent text-accent-foreground">Followed</Badge>}
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div>Score: {candidate.score}</div>
        <div>Resolver: {candidate.resolver}</div>
      </div>
      <div className="break-all text-xs text-muted-foreground">{candidate.url}</div>
      {!!candidate.reasons.length && (
        <div className="text-xs text-muted-foreground">
          Navigation reasoning: {candidate.reasons.slice(0, 3).join(" ")}
        </div>
      )}
      {!!candidate.rejectionReasons.length && (
        <div className="text-xs text-destructive/90">
          Rejections: {candidate.rejectionReasons.slice(0, 3).join(" ")}
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  candidate,
  selected,
}: {
  candidate: CandidateSection;
  selected: boolean;
}) {
  const matrix = candidate.matrix.slice(0, 6);

  return (
    <div
      className={`space-y-3 rounded-lg border p-4 ${
        selected ? "border-accent bg-accent/5" : "border-border bg-background"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{candidate.sectionTitle}</h3>
        <Badge variant="outline">{candidate.kind}</Badge>
        <Badge variant="outline">{candidate.detectedCategory}</Badge>
        <Badge variant="outline">{candidate.detectedSizeSystem}</Badge>
        <Badge variant="outline">{candidate.originalUnitSystem}</Badge>
        <Badge variant="outline">{candidate.matrixOrientation}</Badge>
        <Badge variant="outline">{candidate.categoryMappingMode}</Badge>
        {selected && <Badge className="bg-accent text-accent-foreground">Selected</Badge>}
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
        <div>Audience: {candidate.audience}</div>
        <div>Fit: {candidate.fitVariant}</div>
        <div>Score: {candidate.selectionScore}</div>
        <div>Confidence: {candidate.extractionConfidence.toFixed(2)}</div>
        <div>Document: {candidate.documentKind}</div>
        <div>Navigation: {candidate.navigationConfidence.toFixed(2)}</div>
      </div>

      {candidate.categoryMappingReason && (
        <div className="text-xs text-muted-foreground">
          Category mapping: {candidate.categoryMappingReason}
        </div>
      )}

      {!!candidate.matchReasons.length && (
        <div className="text-xs text-muted-foreground">
          Match reasoning: {candidate.matchReasons.slice(0, 3).join(" ")}
        </div>
      )}

      {!!candidate.rejectionReasons.length && (
        <div className="text-xs text-destructive/90">
          Rejection reasoning: {candidate.rejectionReasons.slice(0, 3).join(" ")}
        </div>
      )}

      {!!candidate.rawSizeAxisLabels.length && (
        <div className="text-xs text-muted-foreground">
          Visible size axis: {candidate.rawSizeAxisLabels.join(", ")}
        </div>
      )}

      {!!candidate.rawStubColumn.length && (
        <div className="text-xs text-muted-foreground">
          Stub labels: {candidate.rawStubColumn.slice(0, 8).join(", ")}
        </div>
      )}

      {!!matrix.length && (
        <div className="overflow-auto rounded border border-border">
          <Table>
            <TableBody>
              {matrix.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.slice(0, 6).map((cell, cellIndex) => (
                    <TableCell key={cellIndex} className="text-xs">
                      {cell || "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function GuidePreviewDialog({ open, onOpenChange, result }: Props) {
  const guide = result?.guide;
  const pipeline = result?.pipeline;
  const requestedCategory = result ? mapRequestedGarmentCategory(result.source.garmentCategory) : null;
  const requestedSizeSystem = result ? mapRequestedSizeSystem(result.source.sizeSystem) : null;

  if (!result) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No result selected</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const visibleCols = guide
    ? MEASURE_COLS.filter((column) =>
        guide.guide.rows.some((row) => row[column.min] != null || row[column.max] != null),
      )
    : [];

  function downloadOne() {
    if (!guide) return;
    const blob = new Blob([JSON.stringify(guide, null, 2)], {
      type: "application/json",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = guideFilename(guide);
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>{result.source.brand}</DialogTitle>
          <DialogDescription>
            Requested {requestedCategory ?? "—"} / {requestedSizeSystem ?? "—"}.
            {guide
              ? ` Accepted from ${guide.guide.sourceSectionTitle}.`
              : " No validated guide was saved."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={guide ? "guide" : "debug"}>
          <TabsList>
            {guide && <TabsTrigger value="guide">Guide</TabsTrigger>}
            <TabsTrigger value="debug">Debug</TabsTrigger>
          </TabsList>

          {guide && (
            <TabsContent value="guide" className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Category</div>
                  <div className="font-medium">{guide.guide.garmentCategory}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Size System</div>
                  <div className="font-medium">{guide.guide.sizeSystem}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Source Section</div>
                  <div className="font-medium">{guide.guide.sourceSectionTitle}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Validation</div>
                  <div className="font-medium">{guide.guide.validationStatus}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Document Kind</div>
                  <div className="font-medium">{guide.guide.documentKind}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Matrix Orientation</div>
                  <div className="font-medium">{guide.guide.matrixOrientation}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Category Mapping</div>
                  <div className="font-medium">{guide.guide.categoryMappingMode}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Resolved Source URL</div>
                  <div className="break-all font-medium">{guide.guide.resolvedSourceUrl}</div>
                </div>
              </div>

              <IssueList
                title="Validation Errors"
                issues={guide.guide.validationErrors}
                destructive
              />
              <IssueList title="Warnings" issues={guide.guide.warnings} />
              <TraceChain steps={guide.guide.sourceTraceChain} />

              <div className="overflow-auto rounded border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Original Label</TableHead>
                      <TableHead>Canonical</TableHead>
                      <TableHead>Fit</TableHead>
                      {visibleCols.map((column) => (
                        <TableHead key={column.label}>{column.label} (cm)</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {guide.guide.rows.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{row.originalLabel}</TableCell>
                        <TableCell>{row.canonicalLabel}</TableCell>
                        <TableCell>{row.fitVariant}</TableCell>
                        {visibleCols.map((column) => (
                          <TableCell key={column.label} className="text-muted-foreground">
                            {fmt(row, column.min, column.max)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background p-3 text-sm">
                <a
                  href={guide.guide.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-muted-foreground underline-offset-4 hover:underline"
                >
                  <ExternalLink className="size-4" />
                  {guide.guide.sourceUrl}
                </a>
                <Button onClick={downloadOne} className="bg-accent text-accent-foreground hover:bg-accent/90">
                  <Download />
                  Download this guide
                </Button>
              </div>
            </TabsContent>
          )}

          <TabsContent value="debug" className="space-y-4">
            {!!pipeline && (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Fetched URL</div>
                    <div className="break-all font-medium">{pipeline.fetchedUrl}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Resolved URL</div>
                    <div className="break-all font-medium">{pipeline.resolvedSourceUrl}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Source Type</div>
                    <div className="font-medium">{pipeline.sourceType}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Document Kind</div>
                    <div className="font-medium">{pipeline.documentKind}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Selected Section</div>
                    <div className="font-medium">
                      {pipeline.selectedCandidateId
                        ? pipeline.discoveredCandidates.find(
                            (candidate) => candidate.id === pipeline.selectedCandidateId,
                          )?.sectionTitle ?? pipeline.selectedCandidateId
                        : "None"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Review Needed</div>
                    <div className="font-medium">
                      {pipeline.manualReviewRecommended ? "Yes" : "No"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Navigation Confidence</div>
                    <div className="font-medium">{pipeline.navigationConfidence.toFixed(2)}</div>
                  </div>
                </div>

                <IssueList
                  title="Validation Errors"
                  issues={pipeline.validationErrors}
                  destructive
                />
                <IssueList title="Warnings" issues={pipeline.warnings} />
                <TraceChain steps={pipeline.sourceTraceChain} />

                {!!pipeline.documentReasoning.length && (
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="text-sm font-semibold">Document reasoning</h3>
                    <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                      {pipeline.documentReasoning.map((line, index) => (
                        <p key={index}>{line}</p>
                      ))}
                    </div>
                  </div>
                )}

                {!!pipeline.selectionReasoning.length && (
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="text-sm font-semibold">Selection reasoning</h3>
                    <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                      {pipeline.selectionReasoning.map((line, index) => (
                        <p key={index}>{line}</p>
                      ))}
                    </div>
                  </div>
                )}

                {!!pipeline.linkCandidates.length && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">
                      Internal guide links ({pipeline.linkCandidates.length})
                    </h3>
                    {pipeline.linkCandidates.map((candidate) => (
                      <LinkCandidateCard key={candidate.id} candidate={candidate} />
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">
                    Discovered candidate sections ({pipeline.discoveredCandidates.length})
                  </h3>
                  {pipeline.discoveredCandidates.map((candidate) => (
                    <CandidateCard
                      key={candidate.id}
                      candidate={candidate}
                      selected={candidate.id === pipeline.selectedCandidateId}
                    />
                  ))}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
