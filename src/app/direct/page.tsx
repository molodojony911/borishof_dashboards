import { DirectPage } from "@/components/DirectPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <DirectPage />
    </Suspense>
  );
}
