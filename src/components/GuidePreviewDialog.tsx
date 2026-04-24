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
import { shoppingAssistantGuideFilename } from "@/lib/normalizers/guideBuilder";
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
  { label: "Poitrine", min: "chestCmMin", max: "chestCmMax" },
  { label: "Taille", min: "waistCmMin", max: "waistCmMax" },
  { label: "Hanches", min: "hipsCmMin", max: "hipsCmMax" },
  { label: "Entrejambe", min: "inseamCmMin", max: "inseamCmMax" },
  { label: "Longueur externe", min: "outseamCmMin", max: "outseamCmMax" },
  { label: "Stature", min: "heightCmMin", max: "heightCmMax" },
  { label: "Cou", min: "neckCmMin", max: "neckCmMax" },
  { label: "Épaules", min: "shoulderCmMin", max: "shoulderCmMax" },
  { label: "Manche", min: "sleeveCmMin", max: "sleeveCmMax" },
  { label: "Pied L.", min: "footLengthCmMin", max: "footLengthCmMax" },
  { label: "Pied l.", min: "footWidthCmMin", max: "footWidthCmMax" },
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
      <h3 className="text-sm font-semibold">Traçabilité de la source</h3>
      <div className="mt-3 space-y-3 text-sm">
        {steps.map((step, index) => (
          <div key={`${step.url}-${index}`} className="rounded border border-border/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{step.kind}</Badge>
              <span className="font-medium">{step.label}</span>
              <span className="text-xs text-muted-foreground">
                confiance {step.confidence.toFixed(2)}
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
        candidate.selected ? "border-primary/40 bg-primary/5" : "border-border bg-background"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{candidate.label}</h3>
        <Badge variant="outline">{candidate.detectedCategory}</Badge>
        <Badge variant="outline">{candidate.detectedSizeSystem}</Badge>
        <Badge variant="outline">{candidate.categoryMappingMode}</Badge>
        {candidate.selected && <Badge className="bg-primary text-primary-foreground">Suivi</Badge>}
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div>Score: {candidate.score}</div>
        <div>Résolution: {candidate.resolver}</div>
      </div>
      <div className="break-all text-xs text-muted-foreground">{candidate.url}</div>
      {!!candidate.reasons.length && (
        <div className="text-xs text-muted-foreground">
          Raisons de navigation: {candidate.reasons.slice(0, 3).join(" ")}
        </div>
      )}
      {!!candidate.rejectionReasons.length && (
        <div className="text-xs text-destructive/90">
          Rejets: {candidate.rejectionReasons.slice(0, 3).join(" ")}
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
        selected ? "border-primary/40 bg-primary/5" : "border-border bg-background"
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
        {selected && <Badge className="bg-primary text-primary-foreground">Sélectionné</Badge>}
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
        <div>Audience: {candidate.audience}</div>
        <div>Coupe: {candidate.fitVariant}</div>
        <div>Score: {candidate.selectionScore}</div>
        <div>Confiance: {candidate.extractionConfidence.toFixed(2)}</div>
        <div>Document: {candidate.documentKind}</div>
        <div>Navigation: {candidate.navigationConfidence.toFixed(2)}</div>
      </div>

      {candidate.categoryMappingReason && (
        <div className="text-xs text-muted-foreground">
          Mapping catégorie: {candidate.categoryMappingReason}
        </div>
      )}

      {!!candidate.matchReasons.length && (
        <div className="text-xs text-muted-foreground">
          Raisons de correspondance: {candidate.matchReasons.slice(0, 3).join(" ")}
        </div>
      )}

      {!!candidate.rejectionReasons.length && (
        <div className="text-xs text-destructive/90">
          Raisons de rejet: {candidate.rejectionReasons.slice(0, 3).join(" ")}
        </div>
      )}

      {!!candidate.rawSizeAxisLabels.length && (
        <div className="text-xs text-muted-foreground">
          Axe tailles visible: {candidate.rawSizeAxisLabels.join(", ")}
        </div>
      )}

      {!!candidate.rawStubColumn.length && (
        <div className="text-xs text-muted-foreground">
          Libellés de lignes: {candidate.rawStubColumn.slice(0, 8).join(", ")}
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
            <DialogTitle>Aucun résultat sélectionné</DialogTitle>
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
    const blob = new Blob([JSON.stringify(guide.shoppingAssistantGuide, null, 2)], {
      type: "application/json",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = shoppingAssistantGuideFilename(guide);
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto bg-card">
        <DialogHeader>
          <DialogTitle>{result.source.brand}</DialogTitle>
          <DialogDescription>
            Demande {requestedCategory ?? "—"} / {requestedSizeSystem ?? "—"}.
            {guide
              ? ` Accepté depuis ${guide.guide.sourceSectionTitle}.`
              : " Aucun guide validé n'a été sauvegardé."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={guide ? "guide" : "debug"}>
          <TabsList>
            {guide && <TabsTrigger value="guide">Guide</TabsTrigger>}
            <TabsTrigger value="debug">Diagnostic</TabsTrigger>
          </TabsList>

          {guide && (
            <TabsContent value="guide" className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Catégorie</div>
                  <div className="font-medium">{guide.guide.garmentCategory}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Système de taille</div>
                  <div className="font-medium">{guide.guide.sizeSystem}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Section source</div>
                  <div className="font-medium">{guide.guide.sourceSectionTitle}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Validation</div>
                  <div className="font-medium">{guide.guide.validationStatus}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Type de document</div>
                  <div className="font-medium">{guide.guide.documentKind}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Orientation matrice</div>
                  <div className="font-medium">{guide.guide.matrixOrientation}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">Mapping catégorie</div>
                  <div className="font-medium">{guide.guide.categoryMappingMode}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="text-muted-foreground">URL source résolue</div>
                  <div className="break-all font-medium">{guide.guide.resolvedSourceUrl}</div>
                </div>
              </div>

              <IssueList
                title="Erreurs de validation"
                issues={guide.guide.validationErrors}
                destructive
              />
              <IssueList title="Avertissements" issues={guide.guide.warnings} />
              <IssueList title="Cohabitation logiciel principal" issues={guide.shoppingAssistantWarnings} />
              <TraceChain steps={guide.guide.sourceTraceChain} />

              <div className="overflow-auto rounded border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Libellé source</TableHead>
                      <TableHead>Canonique</TableHead>
                      <TableHead>Coupe</TableHead>
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
                <Button onClick={downloadOne} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Download />
                  Télécharger ce guide
                </Button>
              </div>
            </TabsContent>
          )}

          <TabsContent value="debug" className="space-y-4">
            {!!pipeline && (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">URL récupérée</div>
                    <div className="break-all font-medium">{pipeline.fetchedUrl}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">URL résolue</div>
                    <div className="break-all font-medium">{pipeline.resolvedSourceUrl}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Type de source</div>
                    <div className="font-medium">{pipeline.sourceType}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Type de document</div>
                    <div className="font-medium">{pipeline.documentKind}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Section sélectionnée</div>
                    <div className="font-medium">
                      {pipeline.selectedCandidateId
                        ? pipeline.discoveredCandidates.find(
                            (candidate) => candidate.id === pipeline.selectedCandidateId,
                          )?.sectionTitle ?? pipeline.selectedCandidateId
                        : "Aucune"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Revue nécessaire</div>
                    <div className="font-medium">
                      {pipeline.manualReviewRecommended ? "Oui" : "Non"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="text-muted-foreground">Confiance navigation</div>
                    <div className="font-medium">{pipeline.navigationConfidence.toFixed(2)}</div>
                  </div>
                </div>

                <IssueList
                  title="Erreurs de validation"
                  issues={pipeline.validationErrors}
                  destructive
                />
                <IssueList title="Avertissements" issues={pipeline.warnings} />
                <TraceChain steps={pipeline.sourceTraceChain} />

                {!!pipeline.documentReasoning.length && (
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="text-sm font-semibold">Raisonnement document</h3>
                    <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                      {pipeline.documentReasoning.map((line, index) => (
                        <p key={index}>{line}</p>
                      ))}
                    </div>
                  </div>
                )}

                {!!pipeline.selectionReasoning.length && (
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="text-sm font-semibold">Raisonnement sélection</h3>
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
                      Liens internes de guide ({pipeline.linkCandidates.length})
                    </h3>
                    {pipeline.linkCandidates.map((candidate) => (
                      <LinkCandidateCard key={candidate.id} candidate={candidate} />
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">
                    Sections candidates détectées ({pipeline.discoveredCandidates.length})
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
