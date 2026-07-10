import { SettingsSection } from "../settings-section";
import { Card, CardBody, EmptyState } from "@/components";

// Placeholder — replaced with active sessions / sign-out-everywhere in WS-7e.
export default function SecuritySettingsPage() {
  return (
    <SettingsSection title="Security" description="Active sessions and devices.">
      <Card><CardBody><EmptyState title="Being set up" description="This section arrives shortly in this update." /></CardBody></Card>
    </SettingsSection>
  );
}
