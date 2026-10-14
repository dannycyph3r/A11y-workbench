import { CRITERIA, type Criterion, type WcagVersion } from "./wcag";

export type ProfileId = "wcag22aa" | "wcag21aa" | "wcag20aa" | "aoda";

export interface AuditProfile {
  id: ProfileId;
  label: string;
  shortLabel: string;
  description: string;
  wcagVersion: WcagVersion;
  /** axe-core tags that select the rules for this profile. */
  axeTags: string[];
  /** Criteria excluded from the profile even though the version contains them. */
  excludedCriteria: string[];
  /** Plain statement shown on every report produced with this profile. */
  basis: string;
}

export const PROFILES: Record<ProfileId, AuditProfile> = {
  wcag22aa: {
    id: "wcag22aa",
    label: "WCAG 2.2 Level AA",
    shortLabel: "WCAG 2.2 AA",
    description: "The current W3C recommendation. Recommended technical target for new work.",
    wcagVersion: "2.2",
    axeTags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    excludedCriteria: [],
    basis: "W3C Web Content Accessibility Guidelines 2.2, Level A and AA success criteria.",
  },
  wcag21aa: {
    id: "wcag21aa",
    label: "WCAG 2.1 Level AA",
    shortLabel: "WCAG 2.1 AA",
    description: "Referenced by many procurement and public-sector policies, including EN 301 549.",
    wcagVersion: "2.1",
    axeTags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    excludedCriteria: [],
    basis: "W3C Web Content Accessibility Guidelines 2.1, Level A and AA success criteria.",
  },
  wcag20aa: {
    id: "wcag20aa",
    label: "WCAG 2.0 Level AA",
    shortLabel: "WCAG 2.0 AA",
    description: "The original 2008 recommendation, still cited by older policies.",
    wcagVersion: "2.0",
    axeTags: ["wcag2a", "wcag2aa"],
    excludedCriteria: [],
    basis: "W3C Web Content Accessibility Guidelines 2.0, Level A and AA success criteria.",
  },
  aoda: {
    id: "aoda",
    label: "AODA (WCAG 2.0 AA basis)",
    shortLabel: "AODA",
    description:
      "Ontario's Integrated Accessibility Standards, section 14, reference WCAG 2.0 Level AA for websites, except live captions and prerecorded audio description.",
    wcagVersion: "2.0",
    axeTags: ["wcag2a", "wcag2aa"],
    excludedCriteria: ["1.2.4", "1.2.5"],
    basis:
      "WCAG 2.0 Level AA as referenced by section 14 of Ontario Regulation 191/11 (Integrated Accessibility Standards), excluding 1.2.4 and 1.2.5. This is a technical reading of that requirement, not a legal opinion; confirm obligations against the current regulation.",
  },
};

export const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];

const ORDER: Record<WcagVersion, number> = { "2.0": 0, "2.1": 1, "2.2": 2 };

/** Criteria in scope for a profile, honouring version, removals and exclusions. */
export function criteriaForProfile(id: ProfileId): Criterion[] {
  const p = PROFILES[id];
  const v = ORDER[p.wcagVersion];
  return CRITERIA.filter((c) => {
    if (ORDER[c.introducedIn] > v) return false;
    if (c.removedIn && ORDER[c.removedIn] <= v) return false;
    return !p.excludedCriteria.includes(c.id);
  });
}

export function isCriterionInProfile(criterionId: string, id: ProfileId): boolean {
  return criteriaForProfile(id).some((c) => c.id === criterionId);
}
