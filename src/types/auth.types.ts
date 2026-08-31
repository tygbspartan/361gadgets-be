export interface RegisterRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface GoogleAuthRequest {
  googleId: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface VerifyEmailRequest {
  token: string;
}

// Self-service: any authenticated user changing their own password.
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// Self-service profile update. Email and role are intentionally NOT editable here.
export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
  // Vendor (company) fields — ignored/harmless for customers.
  companyName?: string;
  logoUrl?: string;
}

export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
  /** Matched against User.tokenVersion to allow server-side revocation. */
  tokenVersion?: number;
}

// ==================== ADMIN (VENDOR) MANAGEMENT — superadmin only ====================

export interface CreateAdminRequest {
  email: string;
  password: string;
  companyName?: string;
  logoUrl?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  // Optional initial brand assignment (must be currently-unassigned brands).
  brandIds?: number[];
}

export interface UpdateAdminRequest {
  companyName?: string;
  logoUrl?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface SetAdminStatusRequest {
  isActive: boolean;
}

export interface ResetAdminPasswordRequest {
  newPassword: string;
}

export interface UserResponse {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: string;
  isEmailVerified: boolean;
  createdAt: Date;
}

// Don't extend Express.Request here - let Passport handle it
// We'll use type assertions in our code instead