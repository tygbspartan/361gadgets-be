import dotenv from 'dotenv';

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

  // Supabase Storage
  supabaseUrl: getEnvVariable('SUPABASE_URL'),
  supabaseServiceRoleKey: getEnvVariable('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseStorageBucket: getEnvVariable('SUPABASE_STORAGE_BUCKET', 'images'),

  // Redis (optional — caching disabled if not set)
  redisUrl: process.env['REDIS_URL'] || null,
};

// Validate critical env variables on startup
export const validateEnv = (): void => {
  // Required in every environment.
  const criticalVars = [
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

  // Additionally required in production — these have dev-friendly defaults that
  // must never be used against real infrastructure.
  const productionVars = [
    'CLIENT_URL',        // used for OAuth redirects + email links
    'DIRECT_URL',        // Prisma migrations (non-pooled connection)
    'SUPABASE_STORAGE_BUCKET',
  ];

  const required =
    config.nodeEnv === 'production'
      ? [...criticalVars, ...productionVars]
      : criticalVars;

  const missing = required.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(varName => console.error(`   - ${varName}`));
    throw new Error('Environment validation failed');
  }

  console.log(`✅ Environment validated (${config.nodeEnv})`);
};