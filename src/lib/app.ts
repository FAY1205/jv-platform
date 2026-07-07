// App-level constants. The product name is a placeholder brand token (SET-09) and
// is swappable; component code must not hardcode it (PRN-12) — read it from here
// or from design tokens once the token source exists (WP-003).
export const APP_NAME = "TerritoryDesk";

export const APP_ENVS = ["development", "preview", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];
