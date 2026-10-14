import type { ProfileId } from "@/lib/standards/profiles";

export type Impact = "critical" | "serious" | "moderate" | "minor";

/**
 * violation:    an automated rule failed with clear evidence.
 * needs-review: an automated rule found something it could not decide.
 * heuristic:    a custom check found a likely problem from indirect evidence.
 * inconclusive: a check ran but could not resolve its inputs (for example
 *               text over an image), so no pass or fail is claimed.
 */
export type FindingKind = "violation" | "needs-review" | "heuristic" | "inconclusive";

export type Category =
  | "contrast"
  | "semantics"
  | "aria"
  | "forms"
  | "keyboard"
  | "images"
  | "structure"
  | "language"
  | "media"
  | "target-size"
  | "other";

export type FixConfidence = "high" | "review" | "manual";

export type VerificationStatus =
  | "unverified" // nothing rerun yet
  | "resolved" // rerun no longer reports it
  | "still-failing" // rerun still reports it
  | "not-testable"; // the rerun cannot speak to it; a person must check

export type FindingSource = "axe" | "custom" | "static-css" | "figma";

export interface SourceLocation {
  /** Character offsets of the element's start tag in the remediation document. */
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface ContrastEvidence {
  foreground?: string;
  background?: string;
  ratio?: number;
  required: number;
  fontSizePx?: number;
  fontWeight?: number;
  isLargeText?: boolean;
  /** Where the foreground colour is declared, when the scan could tell. */
  colorSource?: { kind: "inline" | "rule"; selector?: string; value: string };
  note?: string;
}

export interface FindingNode {
  selector: string;
  html: string;
  failureSummary?: string;
  location?: SourceLocation;
  contrast?: ContrastEvidence;
  /** Free-form evidence lines, already in plain language. */
  evidence: string[];
}

export interface CriterionRef {
  id: string;
  title: string;
  level: "A" | "AA";
  inProfile: boolean;
}

export interface Finding {
  /** Stable fingerprint: rule + node location, so reruns can be matched. */
  id: string;
  ruleId: string;
  source: FindingSource;
  category: Category;
  kind: FindingKind;
  title: string;
  description: string;
  impact: Impact;
  criteria: CriterionRef[];
  isBestPractice: boolean;
  helpUrl?: string;
  node: FindingNode;
  recommendation: string;
  fixConfidence: FixConfidence;
  verification: VerificationStatus;
  manualReview: string[];
}

export type DocumentDialect = "html" | "jsx" | "css";

/**
 * The text the remediation workspace edits. For a URL scan this is the
 * rendered DOM snapshot, never the site's own source files.
 */
export interface RemediationDocument {
  dialect: DocumentDialect;
  fileName: string;
  origin: "url-snapshot" | "user-source" | "fixture";
  text: string;
}

export type AuditInput =
  | { kind: "url"; requestedUrl: string; finalUrl: string; httpStatus?: number }
  | { kind: "source"; fileName: string; dialect: DocumentDialect }
  | { kind: "fixture"; fileName: string }
  | { kind: "figma"; fileName: string; fileKey?: string; nodeIds?: string[]; via: "api" | "json" };

export interface EngineInfo {
  name: string;
  version: string;
  browser?: string;
  workbench: string;
}

export interface Audit {
  id: string;
  createdAt: string;
  isDemo: boolean;
  status: "complete" | "partial";
  input: AuditInput;
  profile: ProfileId;
  includeBestPractice: boolean;
  engine: EngineInfo;
  scope: {
    pageState: string;
    viewport?: { width: number; height: number };
    rulesRun: number;
    notes: string[];
  };
  /** Criteria the automated rules exercised (any result), for coverage reporting. */
  criteriaExercised: string[];
  counts: { passes: number; violations: number; incomplete: number; inapplicable: number };
  findings: Finding[];
  warnings: string[];
  limitations: string[];
  document?: RemediationDocument;
}
