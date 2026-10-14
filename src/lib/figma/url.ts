export interface FigmaRef {
  fileKey: string;
  nodeIds: string[];
}

/** Parses figma.com file, design, proto and branch URLs. Returns null for anything else. */
export function parseFigmaUrl(input: string): FigmaRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/^(www\.)?figma\.com$/.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (!["file", "design", "proto", "board"].includes(parts[0] ?? "")) return null;
  let key = parts[1];
  if (parts[2] === "branch" && parts[3]) key = parts[3];
  if (!key || !/^[A-Za-z0-9]{10,64}$/.test(key)) return null;
  const nodeParam = url.searchParams.get("node-id");
  const nodeIds = nodeParam
    ? nodeParam.split(",").map((id) => id.trim().replace(/-/g, ":")).filter((id) => /^\d+:\d+$/.test(id))
    : [];
  return { fileKey: key, nodeIds };
}
