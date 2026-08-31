import { Router } from 'express';
import passport from '../config/passport.config';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '../validators/schemas';

const router = Router();

// Public routes (rate-limited + validated)
router.post('/register', authLimiter, validateBody(registerSchema), AuthController.register);
router.post('/login', authLimiter, validateBody(loginSchema), AuthController.login);
router.post('/verify-email', authLimiter, validateBody(verifyEmailSchema), AuthController.verifyEmail);
router.post('/resend-verification', authLimiter, validateBody(resendVerificationSchema), AuthController.resendVerification);
router.post('/forgot-password', authLimiter, validateBody(forgotPasswordSchema), AuthController.forgotPassword);
router.post('/reset-password', authLimiter, validateBody(resetPasswordSchema), AuthController.resetPassword);

// Google OAuth routes
router.get(
  '/google',
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false 
  })
);

router.get(
  '/google/callback',
  passport.authenticate('google', { 
    session: false,
    failureRedirect: '/api/auth/google/failure' 
  }),
  AuthController.googleCallback
);

// For testing Google auth in Postman
router.get('/google/success', AuthController.googleSuccess);

// Protected routes (require authentication)
router.get('/me', authenticate, AuthController.getCurrentUser);
router.patch('/me', authenticate, AuthController.updateProfile);
router.post('/change-password', authenticate, validateBody(changePasswordSchema), AuthController.changePassword);

export default router;