import { Router } from 'express'
import authenticateToken from '../middlewares/auth.js'
import { createInventoryStocktake, getInventoryStock, getInventoryStocktakes } from '../controllers/stocktake.js'

const router = Router()
router.get('/stock', authenticateToken, getInventoryStock)
router.get('/stocktakes', authenticateToken, getInventoryStocktakes)
router.post('/stocktakes', authenticateToken, createInventoryStocktake)

export default router
