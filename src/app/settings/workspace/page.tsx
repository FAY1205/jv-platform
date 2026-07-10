import { SettingsSection } from "../settings-section";
import { Card, CardBody, EmptyState } from "@/components";

// Placeholder — replaced with workspace name + brand basics in WS-7c.
export default function WorkspaceSettingsPage() {
  return (
    <SettingsSection title="General" description="Workspace name and branding.">
      <Card><CardBody><EmptyState title="Being set up" description="This section arrives shortly in this update." /></CardBody></Card>
    </SettingsSection>
  );
}
