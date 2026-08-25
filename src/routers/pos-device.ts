import { Router } from 'express'
import authenticateToken, { Role } from '../middlewares/auth.js'
import authorizationPermissions from '../middlewares/permissions.js'
import { createPosDevice, deleteEnrollment, enrollPosDevice, generateEnrollment, getPosDeviceSession, listPosDevices, reenrollPosDevice, updatePosDevice } from '../controllers/pos-device.js'

const router = Router()
router.post('/enroll', enrollPosDevice)
router.get('/session', getPosDeviceSession)
router.use(authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]))
router.get('/', listPosDevices)
router.post('/', createPosDevice)
router.post('/:id/enrollment-code', generateEnrollment)
router.delete('/:id/enrollment-code', deleteEnrollment)
router.post('/:id/re-enroll', reenrollPosDevice)
router.patch('/:id', updatePosDevice)

export default router
