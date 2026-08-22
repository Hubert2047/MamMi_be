import { Router } from 'express'
import { createDiscount, deleteDiscount, getDiscounts, updateDiscount, updateStoreDiscount } from '../controllers/discount.js'
import authenticateToken, { Role } from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'

const router = Router()

router.post('/', authenticateToken, authorizationPermissions([Role.SuperAdmin]), createDiscount)
router.get('/', authenticateToken, getDiscounts)
router.put('/:id', authenticateToken, authorizationPermissions([Role.SuperAdmin]), updateDiscount)
router.put('/:id/store-config', authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), updateStoreDiscount)
router.delete('/:id', authenticateToken, authorizationPermissions([Role.SuperAdmin]), deleteDiscount)

export default router
