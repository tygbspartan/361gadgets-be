import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

interface EnvConfig {
  // Server
  port: number;
  nodeEnv: string;
  clientUrl: string;
  corsOrigins: string[];
  
  // JWT
  jwtSecret: string;
  jwtExpiresIn: string;
  
  // Database
  databaseUrl: string;
  
  // Email (Resend)
  resendApiKey: string;
  emailFrom: string;
  
  // Google OAuth
  googleClientId: string;
  googleClientSecret: string;
  googleCallbackUrl: string;
  
  // Admin Account
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;

  // Where admin/platform notification emails are delivered
  adminNotificationEmail: string;
  
  // Token Expiry
  verificationTokenExpiry: string;
  passwordResetTokenExpiry: string;

  // Storage. The driver is chosen by NODE_ENV in storage.service.ts:
  // production → local disk (served from /uploads), otherwise → Supabase Storage.
  uploadDir: string; // root dir for local-disk uploads
  publicBaseUrl: string; // public origin that serves local uploads (no trailing slash)

  // Supabase Storage
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseStorageBucket: string;

  // Redis (optional)
  redisUrl: string | null;
}

const getEnvVariable = (key: string, defaultValue?: string): string => {
  const value = process.env[key] || defaultValue;
  if (!value && !defaultValue) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value as string;
};

export const config: EnvConfig = {
  // Server
  port: parseInt(getEnvVariable('PORT', '5000')),
  nodeEnv: getEnvVariable('NODE_ENV', 'development'),
  clientUrl: getEnvVariable('CLIENT_URL', 'http://localhost:3000'),
  // Explicit CORS allowlist. Defaults to CLIENT_URL; set CORS_ORIGINS to a
  // comma-separated list when more than one origin (e.g. staging + prod) is allowed.
  corsOrigins: (process.env.CORS_ORIGINS || process.env.CLIENT_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  
  // JWT
  jwtSecret: getEnvVariable('JWT_SECRET'),
  jwtExpiresIn: getEnvVariable('JWT_EXPIRES_IN', '7d'),
  
  // Database
  databaseUrl: getEnvVariable('DATABASE_URL'),
  
  // Email (Resend)
  resendApiKey: getEnvVariable('RESEND_API_KEY'),
  emailFrom: getEnvVariable('EMAIL_FROM'),
  
  // Google OAuth
  googleClientId: getEnvVariable('GOOGLE_CLIENT_ID'),
  googleClientSecret: getEnvVariable('GOOGLE_CLIENT_SECRET'),
  googleCallbackUrl: getEnvVariable('GOOGLE_CALLBACK_URL'),
  
  // Admin Account
  adminEmail: getEnvVariable('ADMIN_EMAIL'),
  adminPassword: getEnvVariable('ADMIN_PASSWORD'),
  adminFirstName: getEnvVariable('ADMIN_FIRST_NAME', 'Admin'),
  adminLastName: getEnvVariable('ADMIN_LAST_NAME', 'User'),

  // Recipient for admin notifications (new orders, catalog requests, etc.)
  adminNotificationEmail: getEnvVariable('ADMIN_NOTIFICATION_EMAIL', '361gadgets.np@gmail.com'),
  
  // Token Expiry
  verificationTokenExpiry: getEnvVariable('VERIFICATION_TOKEN_EXPIRY', '24h'),
  passwordResetTokenExpiry: getEnvVariable('PASSWORD_RESET_TOKEN_EXPIRY', '1h'),

  // Local-disk uploads root. Defaults to <project-root>/uploads; override with
  // UPLOAD_DIR (in prod point it OUTSIDE the deploy dir so redeploys don't wipe it).
  uploadDir: getEnvVariable('UPLOAD_DIR', path.join(__dirname, '../../uploads')),
  // Public origin that serves local uploads. In production this MUST be the API
  // server's real public origin (e.g. https://api.example.com) — it's baked into
  // every stored image URL.
  publicBaseUrl: (
    process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || '5000'}`
  ).replace(/\/+$/, ''),

  // Supabase Storage (used by the Supabase driver; kept required in all envs).
  supabaseUrl: getEnvVariable('SUPABASE_URL'),
  supabaseServiceRoleKey: getEnvVariable('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseStorageBucket: getEnvVariable('SUPABASE_STORAGE_BUCKET', 'images'),

  // Redis (optional — caching disabled if not set)
  redisUrl: process.env['REDIS_URL'] || null,
};

// Validate critical env variables on startup
export const validateEnv = (): void => {
  // Required in every environment (Supabase stays required here — dev uses it,
  // and prod keeps the creds available even though it serves from local disk).
  const required = [
    'JWT_SECRET',
    'DATABASE_URL',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  // Production-only: dev-friendly defaults that must never hit real infra.
  if (config.nodeEnv === 'production') {
    required.push('CLIENT_URL'); // OAuth redirects + email links
    required.push('DIRECT_URL'); // Prisma migrations (non-pooled connection)
    // The local storage driver bakes this into every stored image URL — a wrong
    // value can't be fixed without a DB rewrite, so demand it explicitly.
    required.push('PUBLIC_BASE_URL');
  }

  const missing = [...new Set(required)].filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(varName => console.error(`   - ${varName}`));
    throw new Error('Environment validation failed');
  }

  const storage = config.nodeEnv === 'production' ? 'local-disk' : 'supabase';
  console.log(`✅ Environment validated (${config.nodeEnv}, storage=${storage})`);
};