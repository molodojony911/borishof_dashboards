import { LeadsPage } from "@/components/LeadsPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <LeadsPage />
    </Suspense>
  );
}
