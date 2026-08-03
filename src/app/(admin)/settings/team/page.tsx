import { SettingsSection } from "../settings-section";
import { Card, CardBody, EmptyState } from "@/components";

// Intentional stub (REDESIGN-R3 §4 WS-7 + §5 member role): explains where team management
// will live. Partners are managed on the Partners page, not here.
export default function TeamSettingsPage() {
  return (
    <SettingsSection title="Team" description="People with access to this workspace.">
      <Card>
        <CardBody>
          <EmptyState
            title="Team management coming soon"
            description="Soon you'll be able to invite members with limited, admin-assigned lead visibility. (Partners are managed on the Partners page.)"
          />
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
