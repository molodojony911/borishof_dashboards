import { CampaignsPage } from "@/components/CampaignsPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <CampaignsPage />
    </Suspense>
  );
}
