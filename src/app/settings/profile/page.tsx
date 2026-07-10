import { SettingsSection } from "../settings-section";
import { Card, CardBody, EmptyState } from "@/components";

// Placeholder — replaced with name/email + password change in WS-7c.
export default function ProfileSettingsPage() {
  return (
    <SettingsSection title="Profile" description="Your name, email, and password.">
      <Card><CardBody><EmptyState title="Being set up" description="This section arrives shortly in this update." /></CardBody></Card>
    </SettingsSection>
  );
}
