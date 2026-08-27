import { Router } from 'express'
import authenticateToken, { Role } from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'
import { listLineGroups, updateLineGroup } from '../controllers/line-group.js'

const router = Router()
router.use(authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]))
router.get('/', listLineGroups)
router.patch('/:id', updateLineGroup)

export default router
