import { Router } from 'express'
import authenticateToken from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'
import { createPromotion, deletePromotion, getPromotions, previewPromotions, promotionRoles, updatePromotion, updateStorePromotion } from '../controllers/promotion.js'

const router = Router()
router.get('/', authenticateToken, getPromotions)
router.post('/preview', authenticateToken, previewPromotions)
router.post('/', authenticateToken, authorizationPermissions(promotionRoles.create), createPromotion)
router.put('/:id', authenticateToken, authorizationPermissions(promotionRoles.update), updatePromotion)
router.put('/:id/store-config', authenticateToken, authorizationPermissions(promotionRoles.store), updateStorePromotion)
router.delete('/:id', authenticateToken, authorizationPermissions(promotionRoles.update), deletePromotion)
export default router
