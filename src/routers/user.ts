import { Router } from 'express'
import authenticateToken from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'
import { Role } from '../middlewares/auth.js'
import { createManagedUser, listManagedUsers, updateManagedUser } from '../controllers/user.js'

const router = Router()
router.use(authenticateToken, authorizationPermissions([Role.SuperAdmin]))
router.get('/', listManagedUsers)
router.post('/', createManagedUser)
router.patch('/:id', updateManagedUser)

export default router
