import { Router } from 'express'
import authenticateToken from '../middlewares/auth.js'
import { createCatalogItem, deleteCatalogItem, getCatalogItems, updateCatalogItem } from '../controllers/item.js'

const router = Router()
router.get('/', authenticateToken, getCatalogItems)
router.post('/', authenticateToken, createCatalogItem)
router.put('/:id', authenticateToken, updateCatalogItem)
router.delete('/:id', authenticateToken, deleteCatalogItem)
export default router
