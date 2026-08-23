import { Router } from 'express'
import authenticatePrintAgent from '../middlewares/printAgentAuth.js'
import { claimPrintJob, completePrintJob, failPrintJob } from '../controllers/printAgent.js'

const router = Router()
router.use(authenticatePrintAgent)
router.post('/jobs/claim', claimPrintJob)
router.post('/jobs/:id/complete', completePrintJob)
router.post('/jobs/:id/fail', failPrintJob)

export default router
