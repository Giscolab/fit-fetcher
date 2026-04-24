import { FIELD_TO_ROW_KEYS } from "@/lib/ingestion/measurements";
import {
  canonicalizeSizeLabel,
  isBottomCategory,
  isTopCategory,
  resolveRequestedCategoryMatch,
} from "@/lib/ingestion/taxonomy";
import type {
  CandidateExtraction,
  CandidateSection,
  GarmentCategory,
  MeasurementField,
  SizeSystem,
  ValidationIssue,
  ValidationStatus,
} from "@/lib/types";

const TOP_ALLOWED_FIELDS: MeasurementField[] = [
  "chest",
  "waist",
  "hips",
  "height",
  "sleeve",
  "neck",
  "shoulder",
];

const BOTTOM_ALLOWED_FIELDS: MeasurementField[] = [
  "waist",
  "hips",
  "inseam",
  "outseam",
  "height",
];

const SHOE_ALLOWED_FIELDS: MeasurementField[] = ["footLength", "footWidth"];

function getPresentFields(extraction: CandidateExtraction): MeasurementField[] {
  return extraction.extractedFieldKeys.filter((field) =>
    extraction.rows.some((row) => {
      const [minKey, maxKey] = FIELD_TO_ROW_KEYS[field];
      return row[minKey] != null || row[maxKey] != null;
    }),
  );
}

function hasField(extraction: CandidateExtraction, field: MeasurementField): boolean {
  return getPresentFields(extraction).includes(field);
}

function missingBaseSizeSequence(rows: CandidateExtraction["rows"]): string[] {
  const sequence = ["XS", "S", "M", "L", "XL"];
  const present = new Set(
    rows.map((row) => canonicalizeSizeLabel(row.originalLabel).canonicalLabel),
  );
  const indexes = sequence
    .map((label, index) => (present.has(label) ? index : -1))
    .filter((index) => index >= 0);

  if (indexes.length < 2) return [];
  const min = Math.min(...indexes);
  const max = Math.max(...indexes);
  return sequence.slice(min, max + 1).filter((label) => !present.has(label));
}

function buildIssue(
  candidateId: string,
  severity: "error" | "warning",
  code: string,
  message: string,
  details?: string[],
): ValidationIssue {
  return { candidateId, severity, code, message, details };
}

function resolveCategory(args: {
  requestedCategory: GarmentCategory | null;
  candidate: CandidateSection;
  issues: ValidationIssue[];
}): GarmentCategory | null {
  const match = resolveRequestedCategoryMatch({
    requestedCategory: args.requestedCategory,
    detectedCategory: args.candidate.detectedCategory,
    categoryMappingMode: args.candidate.categoryMappingMode,
  });

  if (match.matchedCategory) {
    return match.matchedCategory;
  }

  if (args.requestedCategory) {
    args.issues.push(
      buildIssue(
        args.candidate.id,
        "error",
        "ambiguous-category",
        "The selected section does not prove the requested garment category at section level.",
      ),
    );
    return null;
  }

  args.issues.push(
    buildIssue(
      args.candidate.id,
      "error",
      "missing-category",
      "No precise garment category could be resolved for this source.",
    ),
  );
  return null;
}

function resolveSizeSystem(args: {
  requestedSizeSystem: SizeSystem | null;
  candidate: CandidateSection;
  issues: ValidationIssue[];
}): SizeSystem | null {
  if (args.requestedSizeSystem) {
    if (args.candidate.detectedSizeSystem === args.requestedSizeSystem) {
      return args.requestedSizeSystem;
    }
    args.issues.push(
      buildIssue(
        args.candidate.id,
        "error",
        "size-system-mismatch",
        `Detected size system ${args.candidate.detectedSizeSystem} does not match requested size system ${args.requestedSizeSystem}.`,
      ),
    );
    return null;
  }

  if (
    args.candidate.detectedSizeSystem === "UNKNOWN" ||
    args.candidate.detectedSizeSystem === "NUMERIC"
  ) {
    args.issues.push(
      buildIssue(
        args.candidate.id,
        "error",
        "missing-size-system",
        "No precise size system could be resolved for this source.",
      ),
    );
    return null;
  }

  if (
    args.candidate.detectedSizeSystem === "FR" ||
    args.candidate.detectedSizeSystem === "EU" ||
    args.candidate.detectedSizeSystem === "US" ||
    args.candidate.detectedSizeSystem === "UK" ||
    args.candidate.detectedSizeSystem === "IT" ||
    args.candidate.detectedSizeSystem === "INT" ||
    args.candidate.detectedSizeSystem === "WAIST_INSEAM" ||
    args.candidate.detectedSizeSystem === "FOOTWEAR" ||
    args.candidate.detectedSizeSystem === "BRA"
  ) {
    return args.candidate.detectedSizeSystem;
  }

  return null;
}

export function validateExtraction(args: {
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  candidate: CandidateSection;
  extraction: CandidateExtraction;
}): {
  validationStatus: ValidationStatus;
  validationErrors: ValidationIssue[];
  warnings: ValidationIssue[];
  resolvedCategory: GarmentCategory | null;
  resolvedSizeSystem: SizeSystem | null;
} {
  const validationErrors: ValidationIssue[] = [];
  const warnings = [...args.extraction.warnings];
  const candidateId = args.candidate.id;
  const presentFields = getPresentFields(args.extraction);
  const resolvedCategory = resolveCategory({
    requestedCategory: args.requestedCategory,
    candidate: args.candidate,
    issues: validationErrors,
  });
  const resolvedSizeSystem = resolveSizeSystem({
    requestedSizeSystem: args.requestedSizeSystem,
    candidate: args.candidate,
    issues: validationErrors,
  });

  if (args.candidate.documentKind === "guide-hub-page") {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "guide-hub-selected",
        "Rejected because a guide hub was selected without isolating a concrete table-backed section.",
      ),
    );
  }

  if (args.candidate.originalUnitSystem === "mixed") {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "mixed-units",
        "Rejected because the selected section mixes cm and inches in the same candidate.",
      ),
    );
  }

  if (args.candidate.originalUnitSystem === "unknown") {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "unknown-units",
        "Rejected because measurement units were not explicit in the selected section.",
      ),
    );
  }

  if (args.candidate.linkOriginId && args.candidate.navigationConfidence < 0.55) {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "low-navigation-confidence",
        "Rejected because the followed internal link was not unique or confident enough.",
      ),
    );
  }

  if (!args.candidate.isTabular) {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "advisory-text",
        "Rejected because advisory text was selected instead of a clear table-backed guide.",
      ),
    );
  }

  if (args.extraction.rows.length === 0) {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "empty-extraction",
        "Rejected because no rows could be extracted from the selected section.",
      ),
    );
  }

  const missingSequentialSizes = missingBaseSizeSequence(args.extraction.rows);
  if (missingSequentialSizes.length > 0) {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "missing-size-sequence",
        "Rejected because the international size sequence has gaps between XS and XL.",
        missingSequentialSizes,
      ),
    );
  }

  const visibleSourceLabels = args.candidate.rawSizeAxisLabels;
  const extractedLabels = args.extraction.rows.map((row) => row.originalLabel);
  const extraLabels = extractedLabels.filter((label) => !visibleSourceLabels.includes(label));
  if (extraLabels.length > 0) {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "invented-row-labels",
        "Rejected because extracted rows included labels not visible in the source section.",
        extraLabels,
      ),
    );
  }

  const missingLabels = visibleSourceLabels.filter((label) => !extractedLabels.includes(label));
  if (missingLabels.length > 0) {
    const message = `Visible source sizes (${visibleSourceLabels.length}) became ${extractedLabels.length} extracted rows.`;
    if (
      visibleSourceLabels.length >= 4 &&
      extractedLabels.length < Math.ceil(visibleSourceLabels.length * 0.75)
    ) {
      validationErrors.push(
        buildIssue(candidateId, "error", "size-breadth-loss", message, missingLabels),
      );
    } else {
      warnings.push(
        buildIssue(candidateId, "warning", "size-breadth-warning", message, missingLabels),
      );
    }
  }

  const droppedVariants = missingLabels.filter((label) => /\b(tall|petite|short|long)\b/i.test(label));
  if (droppedVariants.length > 0) {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "fit-variant-loss",
        "Rejected because visible fit variants such as Tall or Petite were dropped during extraction.",
        droppedVariants,
      ),
    );
  }

  if (hasField(args.extraction, "chest") && hasField(args.extraction, "inseam")) {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "fused-top-bottom-evidence",
        "Rejected because the section appears to fuse tops and bottoms evidence.",
      ),
    );
  }

  if (resolvedCategory) {
    if (isTopCategory(resolvedCategory)) {
      const incompatible = presentFields.filter((field) => !TOP_ALLOWED_FIELDS.includes(field));
      if (incompatible.length > 0) {
        validationErrors.push(
          buildIssue(
            candidateId,
            "error",
            "top-incompatible-fields",
            `Rejected because ${resolvedCategory} guide contained incompatible fields: ${incompatible.join(", ")}.`,
          ),
        );
      }
      if (hasField(args.extraction, "inseam")) {
        validationErrors.push(
          buildIssue(
            candidateId,
            "error",
            "top-has-inseam",
            `Rejected because ${resolvedCategory} guide contained inseam fields.`,
          ),
        );
      }
      if (!hasField(args.extraction, "chest") && !hasField(args.extraction, "height")) {
        validationErrors.push(
          buildIssue(
            candidateId,
            "error",
            "top-missing-chest",
            `Rejected because ${resolvedCategory} guide did not contain a chest, bust, or torso measurement.`,
          ),
        );
      }
      if (args.candidate.detectedCategory === "shoes") {
        validationErrors.push(
          buildIssue(
            candidateId,
            "error",
            "wrong-source-family",
            "Rejected because the selected section belonged to footwear, not tops.",
          ),
        );
      }
    }

    if (isBottomCategory(resolvedCategory)) {
      const incompatible = presentFields.filter((field) => !BOTTOM_ALLOWED_FIELDS.includes(field));
      if (incompatible.length > 0) {
        validationErrors.push(
          buildIssue(
            candidateId,
            "error",
            "bottom-incompatible-fields",
            `Rejected because ${resolvedCategory} guide contained incompatible fields: ${incompatible.join(", ")}.`,
          ),
        );
      }
      if (hasField(args.extraction, "chest")) {
        validationErrors.push(
          buildIssue(
            candidateId,
            "error",
            "bottom-has-chest",
            `Rejected because ${resolvedCategory} guide contained chest fields.`,
          ),
        );
      }
    }

    if (resolvedCategory === "shoes") {
      const incompatible = presentFields.filter((field) => !SHOE_ALLOWED_FIELDS.includes(field));
      if (incompatible.length > 0) {
        validationErrors.push(
          buildIssue(
            candidateId,
            "error",
            "shoe-incompatible-fields",
            `Rejected because shoes guide contained incompatible fields: ${incompatible.join(", ")}.`,
          ),
        );
      }
    }

    if (
      resolvedCategory === "generic-body-guide" &&
      args.candidate.detectedCategory !== "generic-body-guide"
    ) {
      validationErrors.push(
        buildIssue(
          candidateId,
          "error",
          "generic-body-guide-labeling",
          "Rejected because a broad body guide was not explicitly labeled as such in the source.",
        ),
      );
    }
  }

  if (presentFields.length === 0) {
    validationErrors.push(
      buildIssue(
        candidateId,
        "error",
        "no-compatible-fields",
        "Rejected because no compatible measurement fields were extracted from the selected section.",
      ),
    );
  }

  const ambiguousCodes = new Set([
    "ambiguous-category",
    "low-navigation-confidence",
  ]);
  const validationStatus: ValidationStatus =
    validationErrors.length > 0
      ? validationErrors.some((issue) => ambiguousCodes.has(issue.code))
        ? "ambiguous"
        : "rejected"
      : warnings.length > 0
        ? "warning"
        : "accepted";

  return {
    validationStatus,
    validationErrors,
    warnings,
    resolvedCategory,
    resolvedSizeSystem,
  };
}
