import { Router } from 'express'
import authenticateToken, { Role } from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'
import { createCatalogItem, deleteCatalogItem, getCatalogItems, updateCatalogItem } from '../controllers/item.js'

const router = Router()
router.get('/', authenticateToken, getCatalogItems)
router.post('/', authenticateToken, authorizationPermissions([Role.SuperAdmin]), createCatalogItem)
router.put('/:id', authenticateToken, authorizationPermissions([Role.SuperAdmin]), updateCatalogItem)
router.delete('/:id', authenticateToken, authorizationPermissions([Role.SuperAdmin]), deleteCatalogItem)
export default router
