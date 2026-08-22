import { Router } from 'express'
import authenticateToken from '../middlewares/auth.js'
import { getLoginStores, login, logout } from '../controllers/auth.js'

const router = Router()

router.post('/login', login)
router.post('/login-stores', getLoginStores)
router.delete('/logout', authenticateToken, logout)

export default router
