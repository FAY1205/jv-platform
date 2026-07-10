import * as React from "react";

// WS-7: a consistent header for each Settings section (title + one-line description),
// followed by the section's content. Purely presentational.
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-text">{title}</h2>
        {description && <p className="mt-1 text-sm text-text-2">{description}</p>}
      </div>
      {children}
    </section>
  );
}
