import { Router } from 'express'
import {
    createDailyClosing,
    getDailyClosingSummary,
    deleteDailyClosing,
    getClosingOfYesterday,
    getDailyClosings,
    updateDailyClosing,
} from '../controllers/daily-closing.js'
import authenticateToken, { Role } from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'

const router = Router()

router.post('/', authenticateToken, createDailyClosing)
router.get('/summary', authenticateToken, getDailyClosingSummary)
router.get('/', authenticateToken, getDailyClosings)
router.get('/yesterday', authenticateToken, getClosingOfYesterday)
router.put('/:id', authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), updateDailyClosing)
router.delete('/:id', authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), deleteDailyClosing)

export default router
