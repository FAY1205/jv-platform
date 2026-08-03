import { SettingsSection } from "../settings-section";
import { AiSettings } from "./ai-settings";

// WP-AI-2 Task 10: server wrapper for the AI assistant settings section.
export default function AiSettingsPage() {
  return (
    <SettingsSection title="AI assistant" description="The in-app assistant, its monthly allowance, and usage this month.">
      <AiSettings />
    </SettingsSection>
  );
}
