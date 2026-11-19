import { MapsPage } from "@/components/MapsPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <MapsPage />
    </Suspense>
  );
}
