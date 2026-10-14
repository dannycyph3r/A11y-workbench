import type { Category, FixConfidence } from "./types";

/**
 * Plain-language guidance for the rules people meet most often. Rules
 * without an entry fall back to the engine's own help text, with
 * confidence "manual" so nothing is promised that the remediation
 * engine cannot deliver.
 */
export interface RuleGuide {
  category: Category;
  title: string;
  explanation: string;
  recommendation: string;
  fixConfidence: FixConfidence;
  manualReview?: string[];
}

export const RULE_GUIDE: Record<string, RuleGuide> = {
  "color-contrast": {
    category: "contrast",
    title: "Text contrast is below the minimum",
    explanation:
      "People with low vision or colour deficiencies, and anyone reading in bright light, may not be able to read this text against its background.",
    recommendation:
      "Darken or lighten the text colour (or the background) until the ratio meets the threshold. The workspace proposes the nearest colour that keeps the hue.",
    fixConfidence: "review",
    manualReview: ["Check the new colour in hover, focus, visited and disabled states.", "Confirm the change fits the brand palette before shipping."],
  },
  "image-alt": {
    category: "images",
    title: "Image has no text alternative",
    explanation:
      "Screen readers announce an image without alt text by its file name, or skip it, so anyone who cannot see it loses the information it carries.",
    recommendation:
      "Add alt text that says what the image communicates in this context. If the image is purely decorative, use an empty alt attribute so it is skipped.",
    fixConfidence: "manual",
    manualReview: ["Only a person who knows why the image is there can write its alt text."],
  },
  "input-image-alt": {
    category: "images",
    title: "Image button has no text alternative",
    explanation: "An image used as a submit button has no name, so assistive technology cannot say what it does.",
    recommendation: "Add alt text naming the action, such as the word on the button.",
    fixConfidence: "manual",
  },
  "button-name": {
    category: "aria",
    title: "Button has no accessible name",
    explanation: "Screen reader users hear only \"button\" and cannot tell what it does. Voice control users cannot say its name to press it.",
    recommendation:
      "Give the button visible text. For an icon-only button, add an accessible name that describes the action.",
    fixConfidence: "manual",
    manualReview: ["The name must describe the action, which only the author knows."],
  },
  "link-name": {
    category: "aria",
    title: "Link has no accessible name",
    explanation: "Screen reader users hear only \"link\" with no destination.",
    recommendation: "Put descriptive text inside the link, or name an icon-only link by its destination.",
    fixConfidence: "manual",
  },
  label: {
    category: "forms",
    title: "Form field has no label",
    explanation:
      "Without a programmatic label, screen readers cannot say what to enter, and clicking the label text does not focus the field.",
    recommendation: "Add a visible <label> associated with the field through for and id. Placeholder text is not a label.",
    fixConfidence: "manual",
  },
  "select-name": {
    category: "forms",
    title: "Select menu has no label",
    explanation: "Screen readers announce the options but not what is being chosen.",
    recommendation: "Associate a visible <label> with the select.",
    fixConfidence: "manual",
  },
  "html-has-lang": {
    category: "language",
    title: "Page language is not declared",
    explanation:
      "Screen readers use the page language to choose pronunciation rules. Without it, content may be read with the wrong voice and accent.",
    recommendation: "Add a lang attribute to the html element with the content's primary language.",
    fixConfidence: "review",
    manualReview: ["Confirm the language code matches the content."],
  },
  "html-lang-valid": {
    category: "language",
    title: "Page language code is not valid",
    explanation: "An unrecognised language code is ignored, so pronunciation falls back to a default.",
    recommendation: "Use a valid BCP 47 language tag such as en, fr or en-CA.",
    fixConfidence: "review",
  },
  "document-title": {
    category: "structure",
    title: "Page has no title",
    explanation: "The title is the first thing a screen reader announces and the label on the browser tab. Without it, people cannot tell pages apart.",
    recommendation: "Add a <title> that names the page's topic or purpose.",
    fixConfidence: "manual",
  },
  "meta-viewport": {
    category: "structure",
    title: "Zooming is disabled",
    explanation: "The viewport meta tag blocks pinch zoom, which people with low vision rely on.",
    recommendation: "Remove user-scalable=no and any maximum-scale below 2 from the viewport meta tag.",
    fixConfidence: "high",
  },
  "aria-valid-attr": {
    category: "aria",
    title: "ARIA attribute name is not valid",
    explanation: "Browsers ignore misspelled ARIA attributes, so the intended state or property never reaches assistive technology.",
    recommendation: "Correct the attribute name, or remove it if a native HTML attribute already covers it.",
    fixConfidence: "review",
  },
  "aria-roles": {
    category: "aria",
    title: "ARIA role is not valid",
    explanation: "An invalid role is ignored or misreported, which can hide the element's purpose.",
    recommendation: "Use a valid role, or better, a native HTML element with that behaviour built in.",
    fixConfidence: "review",
  },
  "aria-hidden-focus": {
    category: "keyboard",
    title: "Hidden content can still receive focus",
    explanation:
      "Keyboard users can tab to controls inside an aria-hidden region, where screen readers announce nothing.",
    recommendation: "Remove aria-hidden, or make the controls inside unfocusable while hidden (for example with the inert attribute).",
    fixConfidence: "manual",
  },
  "duplicate-id-aria": {
    category: "aria",
    title: "ID referenced by ARIA is not unique",
    explanation: "Labels and descriptions that point at a duplicated ID may announce the wrong text.",
    recommendation: "Give each element a unique id and update the references.",
    fixConfidence: "manual",
  },
  "heading-order": {
    category: "structure",
    title: "Heading levels skip",
    explanation: "Screen reader users navigate by heading level. A skipped level suggests missing content.",
    recommendation: "Use heading levels that reflect the outline. Change styling with CSS, not by picking a different level.",
    fixConfidence: "manual",
  },
  list: {
    category: "structure",
    title: "List contains elements that are not list items",
    explanation: "Screen readers announce list size and position; invalid children break that.",
    recommendation: "Only place <li> elements (or script and template) directly inside <ul> and <ol>.",
    fixConfidence: "manual",
  },
  listitem: {
    category: "structure",
    title: "List item is outside a list",
    explanation: "An <li> outside <ul> or <ol> loses its list semantics.",
    recommendation: "Wrap list items in a <ul> or <ol>.",
    fixConfidence: "manual",
  },
  "frame-title": {
    category: "aria",
    title: "Frame has no title",
    explanation: "Screen reader users cannot tell what an untitled iframe contains before entering it.",
    recommendation: "Add a title attribute that describes the frame's content.",
    fixConfidence: "manual",
  },
  "target-size": {
    category: "target-size",
    title: "Touch target is too small",
    explanation:
      "Small targets with little spacing are hard to hit for people with tremors, limited dexterity or large fingers.",
    recommendation: "Make the target at least 24 by 24 CSS pixels, or keep a 24 pixel circle around it free of other targets.",
    fixConfidence: "review",
  },
  tabindex: {
    category: "keyboard",
    title: "Positive tabindex changes the focus order",
    explanation: "Positive tabindex values pull elements ahead of the natural order, which usually confuses keyboard users.",
    recommendation: "Use tabindex=\"0\" and arrange the DOM order to match the visual order.",
    fixConfidence: "review",
  },
  region: {
    category: "structure",
    title: "Content is outside any landmark",
    explanation: "Screen reader users jump between landmarks; content outside them is easy to miss.",
    recommendation: "Place content inside main, nav, header, footer or another landmark.",
    fixConfidence: "manual",
  },
  "landmark-one-main": {
    category: "structure",
    title: "Page has no main landmark",
    explanation: "A main landmark lets keyboard and screen reader users skip straight to the content.",
    recommendation: "Wrap the primary content in a single <main> element.",
    fixConfidence: "manual",
  },
  "page-has-heading-one": {
    category: "structure",
    title: "Page has no level-one heading",
    explanation: "A level-one heading tells screen reader users where the main content starts.",
    recommendation: "Add an <h1> describing the page's main content.",
    fixConfidence: "manual",
  },
  "link-in-text-block": {
    category: "contrast",
    title: "Link is distinguished by colour alone",
    explanation: "People who cannot perceive the colour difference cannot find the link in the sentence.",
    recommendation: "Underline links in body text, or give them 3:1 contrast against surrounding text plus a non-colour cue on hover and focus.",
    fixConfidence: "review",
  },
  "nested-interactive": {
    category: "keyboard",
    title: "Interactive controls are nested",
    explanation: "A control inside another control is often unreachable or announced incorrectly.",
    recommendation: "Restructure so interactive elements are siblings, not nested.",
    fixConfidence: "manual",
  },
  "autocomplete-valid": {
    category: "forms",
    title: "Autocomplete value is not valid",
    explanation: "Browsers and assistive tools cannot fill in or identify a field with an unrecognised autocomplete token.",
    recommendation: "Use a token from the HTML autofill list, such as email, given-name or street-address.",
    fixConfidence: "review",
  },
  "scrollable-region-focusable": {
    category: "keyboard",
    title: "Scrollable region cannot be reached by keyboard",
    explanation: "Keyboard users cannot scroll a region that never receives focus.",
    recommendation: "Make the region focusable with tabindex=\"0\" and give it an accessible name, or ensure it contains a focusable element.",
    fixConfidence: "review",
  },
  // Custom checks
  "awb-focus-not-visible": {
    category: "keyboard",
    title: "No visible focus indicator",
    explanation: "Keyboard users cannot see which control is focused, so they cannot tell where they are on the page.",
    recommendation: "Add a :focus-visible style with an outline or ring at 3:1 contrast against the surrounding background.",
    fixConfidence: "review",
    manualReview: ["Tab through the page and confirm the indicator is visible on every control."],
  },
  "awb-outline-suppressed": {
    category: "keyboard",
    title: "Focus outline removed without a replacement",
    explanation: "A stylesheet removes the browser's focus outline and adds no other focus style.",
    recommendation: "Remove the outline reset, or add a visible :focus-visible style alongside it.",
    fixConfidence: "review",
  },
  "awb-focus-obscured": {
    category: "keyboard",
    title: "Focused element may be hidden behind fixed content",
    explanation: "A sticky header, banner or widget sits over the focused element, so keyboard users may not see it.",
    recommendation: "Add scroll-padding equal to the sticky element's height, or keep fixed elements from covering focusable content.",
    fixConfidence: "manual",
  },
  "awb-keyboard-trap": {
    category: "keyboard",
    title: "Focus did not move when pressing Tab",
    explanation: "Repeated Tab presses left focus on the same element, which can mean a keyboard trap.",
    recommendation: "Make sure Tab and Shift+Tab always move focus out of the component.",
    fixConfidence: "manual",
  },
  "awb-clickable-not-focusable": {
    category: "keyboard",
    title: "Clickable element is not keyboard accessible",
    explanation: "This element responds to clicks but cannot be focused or activated with a keyboard.",
    recommendation: "Use a native <button> or <a href>. They are focusable and handle Enter and Space without extra code.",
    fixConfidence: "review",
  },
  "awb-role-button-div": {
    category: "semantics",
    title: "Custom button instead of a native button",
    explanation:
      "An element with role=\"button\" needs scripted keyboard handling that is often missing. A native button provides it for free.",
    recommendation: "Replace the element with <button type=\"button\">.",
    fixConfidence: "review",
  },
  "awb-dragging-alternative": {
    category: "keyboard",
    title: "Drag interaction needs a single-pointer alternative",
    explanation: "People who cannot hold and drag need another way to do the same thing.",
    recommendation: "Provide buttons, a menu or click-to-place as an alternative to dragging.",
    fixConfidence: "manual",
  },
  "awb-paste-blocked": {
    category: "forms",
    title: "Pasting into a credential field is blocked",
    explanation: "Blocking paste stops password managers and forces people to transcribe or remember credentials.",
    recommendation: "Remove the paste handler so people can paste and use password managers.",
    fixConfidence: "high",
  },
  "awb-password-autocomplete-off": {
    category: "forms",
    title: "Password field disables autocomplete",
    explanation: "autocomplete=\"off\" on a password field can stop password managers from filling it.",
    recommendation: "Use autocomplete=\"current-password\" or \"new-password\".",
    fixConfidence: "review",
  },
  "awb-css-contrast": {
    category: "contrast",
    title: "Declared text colour fails contrast against its declared background",
    explanation: "This rule sets a text colour and background colour that do not meet the minimum ratio.",
    recommendation: "Adjust the colour pair until the ratio meets the threshold.",
    fixConfidence: "review",
  },
  "awb-figma-contrast": {
    category: "contrast",
    title: "Text layer contrast is below the minimum",
    explanation: "In the design file, this text and the layer behind it do not meet the contrast threshold.",
    recommendation: "Adjust the text or background fill in the design before it is built.",
    fixConfidence: "review",
  },
  "awb-figma-contrast-unresolved": {
    category: "contrast",
    title: "Text contrast could not be measured",
    explanation: "The layer behind this text is a gradient, an image, partly overlapping or blended, so no ratio is claimed.",
    recommendation: "Check this text against its real background by eye or with a colour picker.",
    fixConfidence: "manual",
  },
  "awb-figma-target-size": {
    category: "target-size",
    title: "Interactive-looking layer is smaller than 24 by 24",
    explanation: "Layers named like buttons or icons that are smaller than 24 pixels may become hard-to-hit targets.",
    recommendation: "Make the hit area at least 24 by 24, or confirm spacing will meet 2.5.8 in the build.",
    fixConfidence: "review",
  },
  "awb-figma-small-text": {
    category: "contrast",
    title: "Very small text",
    explanation: "Text under 12 pixels is hard to read for many people. This is a best practice, not a WCAG criterion.",
    recommendation: "Consider a minimum body size of 14 to 16 pixels.",
    fixConfidence: "manual",
  },
};

const CATEGORY_BY_TAG: [string, Category][] = [
  ["cat.color", "contrast"],
  ["cat.forms", "forms"],
  ["cat.keyboard", "keyboard"],
  ["cat.text-alternatives", "images"],
  ["cat.aria", "aria"],
  ["cat.name-role-value", "aria"],
  ["cat.language", "language"],
  ["cat.time-and-media", "media"],
  ["cat.tables", "structure"],
  ["cat.structure", "structure"],
  ["cat.semantics", "semantics"],
  ["cat.parsing", "semantics"],
];

export function categoryFor(ruleId: string, tags: string[]): Category {
  const g = RULE_GUIDE[ruleId];
  if (g) return g.category;
  for (const [tag, cat] of CATEGORY_BY_TAG) if (tags.includes(tag)) return cat;
  return "other";
}
