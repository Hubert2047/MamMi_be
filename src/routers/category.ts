import { Router } from 'express'
import {
    getCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
} from '../controllers/category.js'
import authenticateToken from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'
import { Role } from '../middlewares/auth.js'

const router = Router()

router.get('/', authenticateToken, getCategories)
router.post('/', authenticateToken, authorizationPermissions([Role.SuperAdmin]), createCategory)
router.get('/:id', authenticateToken, getCategoryById)
router.put('/:id', authenticateToken, authorizationPermissions([Role.SuperAdmin]), updateCategory)
router.delete('/:id', authenticateToken, authorizationPermissions([Role.SuperAdmin]), deleteCategory)

export default router
