/**
 * WCAG Level A and AA success criteria, with the WCAG version that
 * introduced each one. This catalogue drives profile scoping, criterion
 * labels in the UI and the manual-review checklist.
 */

export type WcagVersion = "2.0" | "2.1" | "2.2";
export type WcagLevel = "A" | "AA";

export interface Criterion {
  id: string; // "1.4.3"
  title: string;
  level: WcagLevel;
  introducedIn: WcagVersion;
  /** Removed from a later version (4.1.1 Parsing is obsolete in 2.2). */
  removedIn?: WcagVersion;
  /**
   * How much of the criterion an automated, single page-state scan can
   * speak to. "partial" means some failures are detectable but a pass
   * still needs a person. "none" means a person must assess it.
   */
  automation: "partial" | "none";
  /** One line prompt used in the manual-review checklist. */
  manualPrompt: string;
}

export const CRITERIA: Criterion[] = [
  { id: "1.1.1", title: "Non-text Content", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Check that every text alternative actually describes the image's purpose, and that decorative images are hidden." },
  { id: "1.2.1", title: "Audio-only and Video-only (Prerecorded)", level: "A", introducedIn: "2.0", automation: "none", manualPrompt: "Check prerecorded audio-only and video-only media for an equivalent alternative." },
  { id: "1.2.2", title: "Captions (Prerecorded)", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Watch prerecorded video with sound and confirm accurate, synchronised captions." },
  { id: "1.2.3", title: "Audio Description or Media Alternative (Prerecorded)", level: "A", introducedIn: "2.0", automation: "none", manualPrompt: "Confirm prerecorded video has audio description or a full text alternative." },
  { id: "1.2.4", title: "Captions (Live)", level: "AA", introducedIn: "2.0", automation: "none", manualPrompt: "Confirm live audio content in synchronised media is captioned." },
  { id: "1.2.5", title: "Audio Description (Prerecorded)", level: "AA", introducedIn: "2.0", automation: "none", manualPrompt: "Confirm prerecorded video carries audio description of visual information." },
  { id: "1.3.1", title: "Info and Relationships", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Compare the visual structure (headings, lists, tables, groups) with the code structure a screen reader receives." },
  { id: "1.3.2", title: "Meaningful Sequence", level: "A", introducedIn: "2.0", automation: "none", manualPrompt: "Read the page in DOM order with styles off and confirm the meaning survives." },
  { id: "1.3.3", title: "Sensory Characteristics", level: "A", introducedIn: "2.0", automation: "none", manualPrompt: "Check instructions do not rely only on shape, colour, size, location or sound." },
  { id: "1.3.4", title: "Orientation", level: "AA", introducedIn: "2.1", automation: "partial", manualPrompt: "Rotate a phone or tablet and confirm the content works in both orientations." },
  { id: "1.3.5", title: "Identify Input Purpose", level: "AA", introducedIn: "2.1", automation: "partial", manualPrompt: "Confirm fields that collect personal data carry the correct autocomplete token." },
  { id: "1.4.1", title: "Use of Color", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Check that colour is never the only way information, actions or states are conveyed." },
  { id: "1.4.2", title: "Audio Control", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Confirm audio that plays automatically for more than three seconds can be paused or muted." },
  { id: "1.4.3", title: "Contrast (Minimum)", level: "AA", introducedIn: "2.0", automation: "partial", manualPrompt: "Check text over images, gradients and every hover, focus and error state that a single scan did not render." },
  { id: "1.4.4", title: "Resize Text", level: "AA", introducedIn: "2.0", automation: "partial", manualPrompt: "Zoom the browser to 200% and confirm nothing is clipped or lost." },
  { id: "1.4.5", title: "Images of Text", level: "AA", introducedIn: "2.0", automation: "none", manualPrompt: "Look for text rendered as images where real text would work." },
  { id: "1.4.10", title: "Reflow", level: "AA", introducedIn: "2.1", automation: "none", manualPrompt: "View the page at 320 CSS pixels wide and confirm no two-dimensional scrolling for ordinary content." },
  { id: "1.4.11", title: "Non-text Contrast", level: "AA", introducedIn: "2.1", automation: "partial", manualPrompt: "Check control boundaries, focus indicators, icons and chart marks reach 3:1 against their surroundings." },
  { id: "1.4.12", title: "Text Spacing", level: "AA", introducedIn: "2.1", automation: "partial", manualPrompt: "Apply the WCAG text-spacing bookmarklet and confirm nothing overlaps or is cut off." },
  { id: "1.4.13", title: "Content on Hover or Focus", level: "AA", introducedIn: "2.1", automation: "none", manualPrompt: "Check tooltips and popovers can be dismissed, hovered and stay visible until dismissed." },
  { id: "2.1.1", title: "Keyboard", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Complete every task on the page with a keyboard alone." },
  { id: "2.1.2", title: "No Keyboard Trap", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Tab into and out of every widget, embed and dialog." },
  { id: "2.1.4", title: "Character Key Shortcuts", level: "A", introducedIn: "2.1", automation: "none", manualPrompt: "Check single-character shortcuts can be turned off, remapped or only work on focus." },
  { id: "2.2.1", title: "Timing Adjustable", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Check every time limit can be turned off, adjusted or extended." },
  { id: "2.2.2", title: "Pause, Stop, Hide", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Confirm moving, blinking or auto-updating content can be paused, stopped or hidden." },
  { id: "2.3.1", title: "Three Flashes or Below Threshold", level: "A", introducedIn: "2.0", automation: "none", manualPrompt: "Check nothing flashes more than three times a second." },
  { id: "2.4.1", title: "Bypass Blocks", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Confirm a skip link or landmarks let keyboard users bypass repeated blocks." },
  { id: "2.4.2", title: "Page Titled", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Check the page title describes the page's topic or purpose." },
  { id: "2.4.3", title: "Focus Order", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Tab through the page and confirm the order preserves meaning and operability." },
  { id: "2.4.4", title: "Link Purpose (In Context)", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Check every link's purpose is clear from its text or its immediate context." },
  { id: "2.4.5", title: "Multiple Ways", level: "AA", introducedIn: "2.0", automation: "none", manualPrompt: "Confirm there is more than one way to locate this page within the site." },
  { id: "2.4.6", title: "Headings and Labels", level: "AA", introducedIn: "2.0", automation: "none", manualPrompt: "Check headings and labels describe the topic or purpose of what follows." },
  { id: "2.4.7", title: "Focus Visible", level: "AA", introducedIn: "2.0", automation: "partial", manualPrompt: "Tab through the page and confirm you can always see where focus is." },
  { id: "2.4.11", title: "Focus Not Obscured (Minimum)", level: "AA", introducedIn: "2.2", automation: "partial", manualPrompt: "Confirm sticky headers, cookie banners and chat widgets never fully hide the focused element." },
  { id: "2.5.1", title: "Pointer Gestures", level: "A", introducedIn: "2.1", automation: "none", manualPrompt: "Check multipoint or path-based gestures have a single-pointer alternative." },
  { id: "2.5.2", title: "Pointer Cancellation", level: "A", introducedIn: "2.1", automation: "none", manualPrompt: "Check actions fire on pointer up, or can be aborted or undone." },
  { id: "2.5.3", title: "Label in Name", level: "A", introducedIn: "2.1", automation: "partial", manualPrompt: "Confirm each control's accessible name contains its visible label text." },
  { id: "2.5.4", title: "Motion Actuation", level: "A", introducedIn: "2.1", automation: "none", manualPrompt: "Check features triggered by device motion also have a UI control and can be disabled." },
  { id: "2.5.7", title: "Dragging Movements", level: "AA", introducedIn: "2.2", automation: "partial", manualPrompt: "Confirm every drag interaction has a single-pointer alternative such as buttons or a menu." },
  { id: "2.5.8", title: "Target Size (Minimum)", level: "AA", introducedIn: "2.2", automation: "partial", manualPrompt: "Check small targets meet 24 by 24 CSS pixels or have enough spacing, including in other states." },
  { id: "3.1.1", title: "Language of Page", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Confirm the declared page language matches the content's language." },
  { id: "3.1.2", title: "Language of Parts", level: "AA", introducedIn: "2.0", automation: "partial", manualPrompt: "Check passages in another language carry their own lang attribute." },
  { id: "3.2.1", title: "On Focus", level: "A", introducedIn: "2.0", automation: "none", manualPrompt: "Check that moving focus never triggers an unexpected change of context." },
  { id: "3.2.2", title: "On Input", level: "A", introducedIn: "2.0", automation: "none", manualPrompt: "Check changing a setting never triggers an unannounced change of context." },
  { id: "3.2.3", title: "Consistent Navigation", level: "AA", introducedIn: "2.0", automation: "none", manualPrompt: "Compare navigation order across pages of the site." },
  { id: "3.2.4", title: "Consistent Identification", level: "AA", introducedIn: "2.0", automation: "none", manualPrompt: "Check components with the same function are identified the same way across pages." },
  { id: "3.2.6", title: "Consistent Help", level: "A", introducedIn: "2.2", automation: "none", manualPrompt: "Check help mechanisms appear in the same relative order on every page that has them." },
  { id: "3.3.1", title: "Error Identification", level: "A", introducedIn: "2.0", automation: "none", manualPrompt: "Submit forms with errors and confirm each error is identified in text." },
  { id: "3.3.2", title: "Labels or Instructions", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Check every input has a visible label or instructions where needed." },
  { id: "3.3.3", title: "Error Suggestion", level: "AA", introducedIn: "2.0", automation: "none", manualPrompt: "Check error messages suggest how to fix the input when a fix is known." },
  { id: "3.3.4", title: "Error Prevention (Legal, Financial, Data)", level: "AA", introducedIn: "2.0", automation: "none", manualPrompt: "For legal, financial or data submissions, confirm submissions can be reviewed, corrected or reversed." },
  { id: "3.3.7", title: "Redundant Entry", level: "A", introducedIn: "2.2", automation: "none", manualPrompt: "Walk multi-step processes and confirm previously entered information is reused or selectable." },
  { id: "3.3.8", title: "Accessible Authentication (Minimum)", level: "AA", introducedIn: "2.2", automation: "partial", manualPrompt: "Sign in and confirm no cognitive function test is required, and that paste and password managers work." },
  { id: "4.1.1", title: "Parsing", level: "A", introducedIn: "2.0", removedIn: "2.2", automation: "partial", manualPrompt: "Obsolete in WCAG 2.2 and always satisfied for HTML. Kept for 2.0 and 2.1 reporting." },
  { id: "4.1.2", title: "Name, Role, Value", level: "A", introducedIn: "2.0", automation: "partial", manualPrompt: "Use a screen reader on every custom control and confirm its name, role and state are announced." },
  { id: "4.1.3", title: "Status Messages", level: "AA", introducedIn: "2.1", automation: "partial", manualPrompt: "Trigger status messages (saved, results found, errors) and confirm a screen reader announces them." },
];

const byId = new Map(CRITERIA.map((c) => [c.id, c]));

export function getCriterion(id: string): Criterion | undefined {
  return byId.get(id);
}

/** "wcag1411" -> "1.4.11". Returns undefined for tags like "wcag2aa". */
export function criterionIdFromAxeTag(tag: string): string | undefined {
  const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  if (!m) return undefined;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

export function understandingUrl(c: Criterion): string {
  const slug = c.title
    .toLowerCase()
    .replace(/\(|\)|,/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html`;
}
