import { Router } from 'express'
import { getSuperAdminOverview } from '../controllers/overview.js'
import authenticateToken, { Role } from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'

const router = Router()
router.get('/', authenticateToken, authorizationPermissions([Role.SuperAdmin]), getSuperAdminOverview)

export default router
