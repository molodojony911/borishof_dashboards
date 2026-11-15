import { AlertsPage } from "@/components/AlertsPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <AlertsPage />
    </Suspense>
  );
}
