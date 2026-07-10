import { SettingsSection } from "../settings-section";
import { Card, CardBody, EmptyState } from "@/components";

// Intentional stub (REDESIGN-R3 §4 WS-7): billing arrives when the product is productized.
export default function BillingSettingsPage() {
  return (
    <SettingsSection title="Billing" description="Your plan and invoices.">
      <Card>
        <CardBody>
          <EmptyState
            title="Billing coming soon"
            description="This workspace is on the internal plan. Plans, usage, and invoices will appear here once billing is enabled."
          />
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
