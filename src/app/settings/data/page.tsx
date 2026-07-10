import { SettingsSection } from "../settings-section";
import { Card, CardBody, EmptyState } from "@/components";

// Placeholder — replaced with export color-coding, retention, and file formats in WS-7g.
export default function DataSettingsPage() {
  return (
    <SettingsSection title="Data & Export" description="Export options, retention, and file formats.">
      <Card><CardBody><EmptyState title="Being set up" description="This section arrives shortly in this update." /></CardBody></Card>
    </SettingsSection>
  );
}
