import { Router } from 'express';
import { BrandController } from '../controllers/brand.controller';
import { authenticate, isAdmin, isSuperadmin } from '../middleware/auth.middleware';
import { upload, validateImageBuffer } from '../middleware/upload.middleware';

const router = Router();

// Public routes
router.get('/', BrandController.getAll);
router.get('/featured', BrandController.getFeatured);
router.get('/slug/:slug', BrandController.getBySlug);

// Scoped admin list (vendor = own brands; superadmin = all, ?ownerId filter).
// Declared before "/:id" so "admin" isn't captured as an id.
router.get('/admin/list', authenticate, isAdmin, BrandController.getAdminList);

// Read (any privileged user — vendors need to read brands to attach to products)
router.get('/:id', authenticate, isAdmin, BrandController.getById);

// Mutations — superadmin only (vendors request new brands via /catalog-requests)
router.post('/bulk', authenticate, isSuperadmin, BrandController.bulkCreate);
router.post('/', authenticate, isSuperadmin, BrandController.create);
router.put('/:id', authenticate, isSuperadmin, BrandController.update);
router.delete('/:id', authenticate, isSuperadmin, BrandController.delete);

// Logo upload/delete (multipart/form-data, field name: "logo") — superadmin only
router.post('/:id/logo/upload', authenticate, isSuperadmin, upload.single('logo'), validateImageBuffer, BrandController.uploadLogo);
router.delete('/:id/logo', authenticate, isSuperadmin, BrandController.deleteLogo);

export default router;