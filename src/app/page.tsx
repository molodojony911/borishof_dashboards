import { OverviewPage } from "@/components/OverviewPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <OverviewPage />
    </Suspense>
  );
}
