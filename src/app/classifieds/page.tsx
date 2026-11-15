import { Suspense } from "react";
import { ClassifiedsPage } from "@/components/ClassifiedsPage";

export default function Page() {
  return (
    <Suspense>
      <ClassifiedsPage />
    </Suspense>
  );
}
