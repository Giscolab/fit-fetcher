import { createServerFn } from "@tanstack/react-start";
import { runIngestionPipeline } from "@/lib/ingestion/pipeline";
import { normalizeBrandSourceInput } from "@/lib/normalizers/sourceInput";
import { scrapeSizeGuideDocument } from "@/lib/utils/firecrawl";
import type {
  BrandSource,
  GeneratedGuide,
  IngestionPipelineReport,
  ShoppingAssistantImportPayload,
  StrictSizeGuideFailure,
  StrictSizeGuideOutput,
} from "@/lib/types";

export interface ScrapeResponse {
  guide?: GeneratedGuide;
  error?: string;
  reason?: string;
  shoppingAssistantJson?: ShoppingAssistantImportPayload;
  strictJson?: StrictSizeGuideOutput | StrictSizeGuideFailure;
  logs: string[];
  pipeline: IngestionPipelineReport;
}

function pushPipelineDiagnostics(logs: string[], report: IngestionPipelineReport) {
  for (const reason of report.documentReasoning) {
    logs.push(`Diagnostic document: ${reason}`);
  }

  for (const link of report.linkCandidates.slice(0, 8)) {
    const state = link.selected ? "sélectionné" : "rejeté";
    const reason = link.rejectionReasons[0] ?? link.reasons[0] ?? "aucune raison détaillée";
    logs.push(
      `Lien ${state}: "${link.label}" score=${link.score} resolver=${link.resolver} url=${link.url}`,
    );
    logs.push(`  Raison lien: ${reason}`);
  }

  if (report.aiFallbackAttempt) {
    logs.push("Extraction déterministe échouée; tentative du fallback Firecrawl LLM.");
    logs.push(
      [
        `Fallback Firecrawl LLM status=${report.aiFallbackAttempt.status}`,
        `rows=${report.aiFallbackAttempt.rowsCount}`,
        `score=${report.aiFallbackAttempt.score}`,
        `fields=${report.aiFallbackAttempt.extractedFieldKeys.join(", ") || "none"}`,
      ].join(" "),
    );
    logs.push(`Raison fallback IA: ${report.aiFallbackAttempt.reason}`);
  }
}

function failureReason(report: IngestionPipelineReport): string {
  const baseReason =
    report.validationErrors[0]?.message ??
    "La page n'a pas pu être convertie en guide de tailles validé.";

  if (!report.aiFallbackAttempt) return baseReason;

  return `${baseReason} Fallback IA: ${report.aiFallbackAttempt.reason}`;
}

function validateExternalUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("size_guide_url doit être une URL valide");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("size_guide_url doit utiliser http ou https");
  }
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (blocked) {
    throw new Error("size_guide_url pointe vers un hôte interdit");
  }
  return parsed;
}

export const scrapeBrandSource = createServerFn({ method: "POST" })
  .inputValidator((input: { source: BrandSource }) => {
    const source = normalizeBrandSourceInput(input?.source);
    if (!source) {
      throw new Error("Source invalide: brand et size_guide_url ou entry_url sont requis");
    }
    if (source.brand.length > 200) {
      throw new Error("brand est trop long");
    }
    if (source.size_guide_url.length > 2048) {
      throw new Error("size_guide_url est trop long");
    }
    const url = validateExternalUrl(source.size_guide_url);
    return {
      source: { ...source, size_guide_url: url.toString() },
    };
  })
  .handler(async ({ data }): Promise<ScrapeResponse> => {
    const { source } = data;
    const logs: string[] = [];

    try {
      logs.push(`Étape 1/5 récupération: ${source.size_guide_url}`);
      const scraped = await scrapeSizeGuideDocument(source.size_guide_url);
      logs.push(
        `Page récupérée: ${scraped.html.length} caractères HTML et ${scraped.markdown.length} caractères markdown.`,
      );

      logs.push("Étape 2/5 normalisation: préparation du contenu brut.");
      logs.push("Étape 3/5 découverte: segmentation des sections candidates.");
      const { guide, report } = await runIngestionPipeline({
        source,
        fetchedUrl: scraped.sourceUrl,
        html: scraped.html,
        markdown: scraped.markdown,
        fetchDocument: scrapeSizeGuideDocument,
      });

      logs.push(
        `${report.discoveredCandidates.length} section(s) candidate(s) détectée(s).`,
      );
      logs.push(`Type de document: ${report.documentKind}.`);
      const followedSteps = report.sourceTraceChain.filter(
        (step) => step.kind === "followed-link" || step.kind === "brand-fallback",
      );
      if (report.followedUrl || followedSteps.length > 0) {
        logs.push(`Chaîne de guide suivie jusqu'à ${report.followedUrl ?? followedSteps.at(-1)?.url}.`);
      }
      if (followedSteps.length > 1) {
        logs.push(`Trace: ${followedSteps.map((step) => step.url).join(" -> ")}`);
      }
      if (report.linkCandidates.length > 0) {
        logs.push(`${report.linkCandidates.length} lien(s) interne(s) candidat(s) détecté(s).`);
      }
      pushPipelineDiagnostics(logs, report);

      if (report.selectedCandidateId) {
        const selected = report.discoveredCandidates.find(
          (candidate) => candidate.id === report.selectedCandidateId,
        );
        logs.push(
          `Selected section ${selected?.sectionTitle ?? report.selectedCandidateId}.`,
        );
        if (selected) {
          logs.push(
            `Selected orientation ${selected.matrixOrientation} with ${selected.rawSizeAxisLabels.length} visible source sizes.`,
          );
        }
        logs.push("Étape 4/5 extraction: extraction de la seule section sélectionnée.");
        logs.push("Étape 5/5 validation: contrôles sémantiques et traçabilité.");
      } else {
        logs.push("Aucune section candidate n'a été sélectionnée automatiquement.");
      }

      for (const reason of report.selectionReasoning) {
        logs.push(reason);
      }
      for (const issue of report.validationErrors) {
        logs.push(`Erreur de validation: ${issue.message}`);
        for (const detail of issue.details ?? []) {
          logs.push(`  Détail validation: ${detail}`);
        }
      }
      for (const warning of report.warnings) {
        logs.push(`Avertissement: ${warning.message}`);
      }

      if (!guide) {
        const reason = failureReason(report);
        return {
          error: "NO_VALID_SIZE_GUIDE",
          reason,
          strictJson: {
            error: "NO_VALID_SIZE_GUIDE",
            reason,
          },
          logs,
          pipeline: report,
        };
      }

      logs.push(`Guide accepté ${guide.guide.id} depuis la section ${guide.guide.sourceSectionTitle}.`);
      if (guide.shoppingAssistantWarnings.length > 0) {
        logs.push(
          `${guide.shoppingAssistantWarnings.length} avertissement(s) de cohabitation avec le logiciel principal.`,
        );
      }

      return {
        guide,
        shoppingAssistantJson: guide.shoppingAssistantGuide,
        strictJson: guide.strictGuide,
        logs,
        pipeline: report,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(`ERREUR: ${message}`);
      return {
        error: "NO_VALID_SIZE_GUIDE",
        reason: message,
        strictJson: {
          error: "NO_VALID_SIZE_GUIDE",
          reason: message,
        },
        logs,
        pipeline: {
          fetchedUrl: source.size_guide_url,
          resolvedSourceUrl: source.size_guide_url,
          requestedCategory: null,
          requestedSizeSystem: null,
          sourceType: "category-specific-page",
          documentKind: "irrelevant",
          documentReasoning: [],
          sourceTraceChain: [
            {
              kind: "requested-url",
              url: source.size_guide_url,
              label: source.name?.trim() || source.brand,
              confidence: 1,
              reasons: ["Initial requested size-guide URL."],
            },
          ],
          linkCandidates: [],
          navigationConfidence: 0,
          discoveredCandidates: [],
          rejectedCandidateIds: [],
          selectionReasoning: [],
          candidateExtractions: [],
          validationStatus: "rejected",
          validationErrors: [
            {
              code: "server-error",
              message,
              severity: "error",
            },
          ],
          warnings: [],
          manualReviewRecommended: true,
        },
      };
    }
  });
