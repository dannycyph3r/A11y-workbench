import type { Finding, VerificationStatus } from "@/lib/findings/types";

export interface PatchValidation {
  ok: boolean;
  errors: string[];
}

export interface VerificationItem {
  findingId: string;
  status: VerificationStatus;
  note: string;
}

export interface VerificationResult {
  validation: PatchValidation;
  results: VerificationItem[];
  introduced: Finding[];
  beforeCount: number;
  afterCount: number;
  engine: { version: string; browser?: string };
  ranAt: string;
}
