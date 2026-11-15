import { BrandsPage } from "@/components/BrandsPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <BrandsPage />
    </Suspense>
  );
}
