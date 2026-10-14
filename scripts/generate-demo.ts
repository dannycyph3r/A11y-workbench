/**
 * Regenerates the bundled demo audit by scanning the sample clinic page
 * with the real engine. Run with `npm run demo:generate`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { scanDocument } from "@/lib/scanner/scan";

async function main() {
  const text = readFileSync("fixtures/known-bad.html", "utf8");
  const { audit } = await scanDocument(
    { dialect: "html", text, fileName: "maple-ridge-booking.html", origin: "fixture" },
    { profile: "wcag22aa", includeBestPractice: true },
  );
  audit.id = "demo-maple-ridge";
  audit.isDemo = true;
  audit.createdAt = "2026-10-13T12:00:00.000Z";
  audit.input = { kind: "fixture", fileName: "maple-ridge-booking.html" };
  audit.scope.notes.unshift("Demo data: recorded from a real scan of a bundled sample page for a fictional clinic. It is not a scan of any live site.");
  writeFileSync("src/lib/demo/demo-audit.json", JSON.stringify(audit, null, 1) + "\n");
  console.log(`Wrote ${audit.findings.length} findings.`);
  process.exit(0);
}
void main();
