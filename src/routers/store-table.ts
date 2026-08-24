import { Router } from 'express'
import { createStoreTable, getStoreTables, regenerateAllStoreTableQr, regenerateStoreTableQr } from '../controllers/store-table.js'
import authenticateToken from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'
import { Role } from '../constants/role.js'

const router = Router()
router.get('/', authenticateToken, getStoreTables)
router.post('/', authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), createStoreTable)
router.post('/regenerate-qr-all', authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), regenerateAllStoreTableQr)
router.post('/:id/regenerate-qr', authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), regenerateStoreTableQr)
export default router
