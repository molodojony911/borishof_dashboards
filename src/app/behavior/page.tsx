import { BehaviorPage } from "@/components/BehaviorPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <BehaviorPage />
    </Suspense>
  );
}
