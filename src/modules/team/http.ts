import { jsonError } from "@/lib/http";
import {
  TeamTargetNotFoundError,
  SelfActionError,
  OwnerImmutableError,
  OwnerOnlyError,
  RoleSyncFailedError,
  ResendThrottledError,
} from "./team";

/** Shared team-error → uniform-envelope mapping (API-01) for the /api/admin/team routes.
 *  Lives here, not in a route file — Next allows only handler exports from routes. */
export function mapSeatError(e: unknown) {
  if (e instanceof TeamTargetNotFoundError) return jsonError("not_found", e.message, 404);
  if (e instanceof SelfActionError) return jsonError("self_change_forbidden", e.message, 409);
  if (e instanceof OwnerImmutableError) return jsonError("owner_immutable", e.message, 409);
  if (e instanceof OwnerOnlyError) return jsonError("forbidden", e.message, 403);
  if (e instanceof RoleSyncFailedError) return jsonError("role_sync_failed", e.message, 502);
  if (e instanceof ResendThrottledError) return jsonError("throttled", e.message, 429);
  return null;
}
