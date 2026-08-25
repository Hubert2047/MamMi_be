import { Router } from 'express'
import { closeStoreTableSession, createStoreTable, extendStoreTableSession, getStoreTables, openStoreTableSession, regenerateAllStoreTableQr, regenerateStoreTableQr } from '../controllers/store-table.js'
import authenticateToken from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'
import { Role } from '../constants/role.js'

const router = Router()
router.get('/', authenticateToken, getStoreTables)
router.post('/', authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), createStoreTable)
router.post('/regenerate-qr-all', authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), regenerateAllStoreTableQr)
router.post('/:id/regenerate-qr', authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), regenerateStoreTableQr)
router.post('/:id/session/open', authenticateToken, authorizationPermissions([Role.Employee, Role.Admin, Role.SuperAdmin]), openStoreTableSession)
router.post('/:id/session/extend', authenticateToken, authorizationPermissions([Role.Employee, Role.Admin, Role.SuperAdmin]), extendStoreTableSession)
router.post('/:id/session/close', authenticateToken, authorizationPermissions([Role.Employee, Role.Admin, Role.SuperAdmin]), closeStoreTableSession)
export default router
