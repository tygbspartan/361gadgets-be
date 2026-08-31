import { ForbiddenError } from "./customError.util";
import { ROLES } from "../constants/roles.constants";
import { JwtPayload } from "../types/auth.types";

/**
 * Enforce that the current user owns the resource.
 * Superadmins bypass ownership (they can manage everything).
 * A vendor (admin) may only act on resources whose ownerId matches their id.
 */
export function assertOwnership(
  ownerId: number | null | undefined,
  user: JwtPayload,
  message = "You can only manage your own items.",
): void {
  if (user.role === ROLES.SUPERADMIN) return;
  if (ownerId == null || ownerId !== user.userId) {
    throw new ForbiddenError(message);
  }
}

/** True when the user is a vendor scoped to their own data (i.e. not a superadmin). */
export function isScopedVendor(user: JwtPayload): boolean {
  return user.role !== ROLES.SUPERADMIN;
}
