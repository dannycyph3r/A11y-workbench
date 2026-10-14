import { Suspense } from "react";
import type { Metadata } from "next";
import { FindingsView } from "./findings-view";

export const metadata: Metadata = { title: "Findings" };

export default function Page() {
  return (
    <Suspense>
      <FindingsView />
    </Suspense>
  );
}
