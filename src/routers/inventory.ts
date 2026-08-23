import { Router } from 'express'
import authenticateToken from '../middlewares/auth.js'
import { createInventoryItem, createInventoryReceipt, getInventoryItems, getInventoryReceipts, updateInventoryItem } from '../controllers/inventory.js'

const router = Router()
router.get('/items', authenticateToken, getInventoryItems)
router.post('/items', authenticateToken, createInventoryItem)
router.put('/items/:id', authenticateToken, updateInventoryItem)
router.get('/receipts', authenticateToken, getInventoryReceipts)
router.post('/receipts', authenticateToken, createInventoryReceipt)

export default router
