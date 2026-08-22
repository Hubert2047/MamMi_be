import { Router } from 'express'
import authenticateToken from '../middlewares/auth.js'
import { addStoreAddon, getStoreAddons, updateStoreAddon } from '../controllers/addon.js'

const router = Router()
router.get('/', authenticateToken, getStoreAddons)
router.post('/', authenticateToken, addStoreAddon)
router.put('/:addonId', authenticateToken, updateStoreAddon)
export default router
