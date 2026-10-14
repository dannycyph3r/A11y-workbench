import { Suspense } from "react";
import type { Metadata } from "next";
import { WorkspaceView } from "./workspace-view";

export const metadata: Metadata = { title: "Remediation workspace" };

export default function Page() {
  return (
    <Suspense>
      <WorkspaceView />
    </Suspense>
  );
}
