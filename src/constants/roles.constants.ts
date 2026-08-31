// User roles for the 361 Gadgets marketplace.
// - customer:   shoppers (self-register)
// - admin:      vendors — manage only their own products/discounts/orders
// - superadmin: platform operator — manages global catalog and moderates vendors
export const ROLES = {
  CUSTOMER: "customer",
  ADMIN: "admin",
  SUPERADMIN: "superadmin",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// Has access to admin/vendor endpoints (both vendors and the superadmin).
export const isPrivileged = (role?: string | null): boolean =>
  role === ROLES.ADMIN || role === ROLES.SUPERADMIN;

// Platform operator only.
export const isSuper = (role?: string | null): boolean =>
  role === ROLES.SUPERADMIN;
