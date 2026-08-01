import * as React from "react";

// Shared field label with a consistent required/optional marker (owner note #27:
// required-ness was invisible across the app). Convention: a red asterisk marks a
// required field; "(optional)" marks an optional one where it isn't obvious. A field
// should set at most one — most forms mark only the required fields.
export function FieldLabel({
  htmlFor,
  children,
  required,
  optional,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-semibold text-text-2">
      {children}
      {required && (
        <span className="text-danger" aria-hidden="true">
          {" *"}
        </span>
      )}
      {optional && !required && <span className="font-normal text-text-3"> (optional)</span>}
    </label>
  );
}
