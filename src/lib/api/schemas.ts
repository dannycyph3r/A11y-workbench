import { z } from "zod";
import { PROFILE_IDS } from "@/lib/standards/profiles";

const profile = z.enum(PROFILE_IDS as [string, ...string[]]).default("wcag22aa");
const viewport = z.enum(["desktop", "tablet", "mobile"]).default("desktop");

export const ScanOptionsSchema = z.object({
  profile,
  includeBestPractice: z.boolean().default(true),
  viewport,
});

export const UrlScanSchema = ScanOptionsSchema.extend({
  url: z.string().min(1, "Enter a URL.").max(2048),
  authorized: z.literal(true, { message: "Confirm you own the site or are authorised to assess it." }),
});

export const MAX_SOURCE_CHARS = 300_000;

export const SourceScanSchema = ScanOptionsSchema.extend({
  text: z.string().min(1, "Paste or upload some source first.").max(MAX_SOURCE_CHARS, "Source is larger than 300,000 characters."),
  fileName: z
    .string()
    .max(120)
    .regex(/^[\w .()\-]+$/, "Use a plain file name.")
    .default("source.html"),
  dialect: z.enum(["html", "jsx", "css"]).optional(),
});

export const FigmaImportSchema = z.object({ url: z.string().min(1).max(2048), profile });

const LocationSchema = z.object({ start: z.number().int().min(0), end: z.number().int().min(0), line: z.number().int(), column: z.number().int() });

export const VerifySchema = ScanOptionsSchema.extend({
  document: z.object({
    dialect: z.enum(["html", "jsx", "css"]),
    fileName: z.string().max(200),
    origin: z.enum(["url-snapshot", "user-source", "fixture"]),
    text: z.string().max(2_000_000),
  }),
  patched: z.string().max(2_200_000),
  edits: z.array(z.object({ start: z.number().int().min(0), end: z.number().int().min(0), replacement: z.string().max(20_000) })).max(500),
  findings: z
    .array(z.object({ id: z.string().max(40), ruleId: z.string().max(80), node: z.object({ selector: z.string().max(2000), location: LocationSchema.optional() }) }))
    .max(1000),
});

export const ExplainSchema = z.object({
  finding: z.object({
    ruleId: z.string().max(80),
    title: z.string().max(300),
    kind: z.enum(["violation", "needs-review", "heuristic", "inconclusive"]),
    impact: z.enum(["critical", "serious", "moderate", "minor"]),
    criteria: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).max(10),
    node: z.object({ html: z.string().max(2000), evidence: z.array(z.string().max(1000)).max(20) }).passthrough(),
  }).passthrough(),
});

export function inferDialect(fileName: string, text: string): "html" | "jsx" | "css" {
  if (/\.(jsx|tsx)$/i.test(fileName)) return "jsx";
  if (/\.(css|scss)$/i.test(fileName)) return "css";
  if (/\.html?$/i.test(fileName)) return "html";
  if (/className=|import\s.+from\s|export\s+(default\s+)?function|=>\s*\(?\s*</.test(text)) return "jsx";
  if (/^\s*[^<{]*\{[^}]*:[^}]*\}/.test(text) && !/<[a-z]/i.test(text)) return "css";
  return "html";
}
