import type { Metadata } from "next";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return <ReportsView />;
}
