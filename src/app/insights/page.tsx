import { InsightsPage } from "@/components/InsightsPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <InsightsPage />
    </Suspense>
  );
}
