import { SettingsSection } from "../settings-section";
import { Card, CardBody, EmptyState } from "@/components";

// Placeholder — replaced with the theme control in WS-7c.
export default function AppearanceSettingsPage() {
  return (
    <SettingsSection title="Appearance" description="Theme and display preferences.">
      <Card><CardBody><EmptyState title="Being set up" description="This section arrives shortly in this update." /></CardBody></Card>
    </SettingsSection>
  );
}
