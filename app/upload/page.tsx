import { AppShell } from "@/frontend/components/AppShell";
import { UploadWorkspace } from "@/frontend/components/UploadWorkspace";
import { PageHeader } from "@/frontend/components/ui";

export const dynamic = "force-dynamic";

export default function UploadPage() {
  return (
    <AppShell>
      <PageHeader
        title="Upload notes"
        description="Upload study files to Supabase Storage or save manual notes directly to your workspace."
      />
      <UploadWorkspace />
    </AppShell>
  );
}
