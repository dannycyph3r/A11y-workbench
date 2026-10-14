import { Suspense } from "react";
import type { Metadata } from "next";
import { NewAudit } from "./new-audit";

export const metadata: Metadata = { title: "New audit" };

export default function Page() {
  return (
    <Suspense>
      <NewAudit />
    </Suspense>
  );
}
