import { SetupPage } from "@/components/SetupPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <SetupPage />
    </Suspense>
  );
}
