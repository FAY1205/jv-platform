import { SettingsSection } from "../settings-section";
import { AiSettings } from "./ai-settings";

// WP-AI-2 Task 10: server wrapper for the AI assistant settings section.
export default function AiSettingsPage() {
  return (
    // Copy tracks what AiSettings actually renders: an enable switch + the tenant's own
    // provider credential. The monthly allowance went with ADR-0036 and the usage panel was
    // dropped 2026-08-19 — promising either here sent admins looking for a section that
    // isn't there.
    <SettingsSection title="AI assistant" description="The in-app assistant and its provider connection.">
      <AiSettings />
    </SettingsSection>
  );
}
