import { Router } from 'express'
import { confirmGuestCart, createGuestCart, getGuestCart, getQrMenu, updateGuestCart } from '../controllers/public-order.js'

const router = Router()
router.get('/qr/:token', getQrMenu)
router.post('/qr/:token/carts', createGuestCart)
router.get('/carts/:cartToken', getGuestCart)
router.patch('/carts/:cartToken', updateGuestCart)
router.post('/carts/:cartToken/confirm', confirmGuestCart)
export default router
