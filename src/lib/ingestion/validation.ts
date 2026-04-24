import { FIELD_TO_ROW_KEYS } from "@/lib/ingestion/measurements";
import {
  isBottomCategory,
  isTopCategory,
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
  if (args.requestedCategory) {
    if (args.candidate.detectedCategory === args.requestedCategory) {
      return args.requestedCategory;
    }
    if (
      args.candidate.detectedCategory === "tops" ||
      args.candidate.detectedCategory === "bottoms" ||
      args.candidate.detectedCategory === "unknown"
    ) {
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
        "category-mismatch",
        `Detected category ${args.candidate.detectedCategory} does not match requested category ${args.requestedCategory}.`,
      ),
    );
    return null;
  }

  if (
    args.candidate.detectedCategory === "tops" ||
    args.candidate.detectedCategory === "bottoms" ||
    args.candidate.detectedCategory === "unknown"
  ) {
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

  if (
    args.candidate.detectedCategory === "tshirts" ||
    args.candidate.detectedCategory === "shirts" ||
    args.candidate.detectedCategory === "hoodies" ||
    args.candidate.detectedCategory === "jackets" ||
    args.candidate.detectedCategory === "pants" ||
    args.candidate.detectedCategory === "jeans" ||
    args.candidate.detectedCategory === "shorts" ||
    args.candidate.detectedCategory === "leggings" ||
    args.candidate.detectedCategory === "bras" ||
    args.candidate.detectedCategory === "shoes" ||
    args.candidate.detectedCategory === "generic-body-guide"
  ) {
    return args.candidate.detectedCategory;
  }

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

  const visibleSizeCount = args.candidate.visibleRowLabels.length;
  const extractedLabels = args.extraction.rows.map((row) => row.originalLabel);
  const extraLabels = extractedLabels.filter(
    (label) => !args.candidate.visibleRowLabels.includes(label),
  );
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

  if (visibleSizeCount > extractedLabels.length) {
    const message = `Visible source sizes (${visibleSizeCount}) became ${extractedLabels.length} extracted rows.`;
    if (
      visibleSizeCount >= 4 &&
      extractedLabels.length < Math.ceil(visibleSizeCount * 0.75)
    ) {
      validationErrors.push(
        buildIssue(candidateId, "error", "size-breadth-loss", message),
      );
    } else {
      warnings.push(
        buildIssue(candidateId, "warning", "size-breadth-warning", message),
      );
    }
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
      const incompatible = presentFields.filter(
        (field) => !TOP_ALLOWED_FIELDS.includes(field),
      );
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
    }

    if (isBottomCategory(resolvedCategory)) {
      const incompatible = presentFields.filter(
        (field) => !BOTTOM_ALLOWED_FIELDS.includes(field),
      );
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
      const incompatible = presentFields.filter(
        (field) => !SHOE_ALLOWED_FIELDS.includes(field),
      );
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

  const validationStatus: ValidationStatus =
    validationErrors.length > 0
      ? validationErrors.some((issue) => issue.code.startsWith("ambiguous"))
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
