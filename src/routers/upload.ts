import { Router } from 'express'
import authenticateToken from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'
import { Role } from '../constants/role.js'
import { createCloudinaryUploadSignature } from '../controllers/upload.js'

const router = Router()
router.post('/cloudinary/signature', authenticateToken, authorizationPermissions([Role.SuperAdmin]), createCloudinaryUploadSignature)

export default router
