import { Router } from 'express'
import authenticateToken from '../middlewares/auth.js'
import { createInventoryItem, createInventoryReceipt, deleteInventoryReceipt, getInventoryItems, getInventoryReceipts, updateInventoryItem, updateInventoryReceipt } from '../controllers/inventory.js'

const router = Router()
router.get('/items', authenticateToken, getInventoryItems)
router.post('/items', authenticateToken, createInventoryItem)
router.put('/items/:id', authenticateToken, updateInventoryItem)
router.get('/receipts', authenticateToken, getInventoryReceipts)
router.post('/receipts', authenticateToken, createInventoryReceipt)
router.put('/receipts/:id', authenticateToken, updateInventoryReceipt)
router.delete('/receipts/:id', authenticateToken, deleteInventoryReceipt)

export default router
