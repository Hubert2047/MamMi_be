import bodyParser from 'body-parser'
import dotenv from 'dotenv'
import { createServer } from 'node:http'
import type { Application } from 'express'
import express from 'express'
import { connectDB } from './config/db.js'
import item from './routers/item.js'
import catalogItem from './routers/catalog-item.js'
import storeItem from './routers/store-item.js'
import order from './routers/order.js'
import category from './routers/category.js'
import cors from 'cors'
import expense from './routers/expense.js'
import discount from './routers/discount.js'
import addon from './routers/addon.js'
import storeAddon from './routers/store-addon.js'
import revenue from './routers/revenue.js'
import dailyClosing from './routers/daily-closing.js'
import employee from './routers/employee.js'
import refreshTokenRoutes from './routers/refresh-token.js'
import auth from './routers/auth.js'
import shiftAttendance from './routers/shift-attendance.js'
import unit from './routers/unit.js'
import { ensureDefaultUnits } from './controllers/unit.js'
import inventory from './routers/inventory.js'
import stocktake from './routers/stocktake.js'
import cookieParser from 'cookie-parser'
import webhook from './routers/webhook.js'
import { ensureDefaultUsers } from './controllers/auth.js'
import Store from './models/store.js'
import store from './routers/store.js'
import user from './routers/user.js'
import { ensureStoreAddons, ensureStoreCatalog, ensureStoreScopedFinancialData, migrateStoreAddonAvailability, migrateStoreItemAvailability } from './services/storeCatalogMigration.js'
import { initializeRealtime } from './realtime.js'
import printAgent from './routers/print-agent.js'
import printAgentAdmin from './routers/print-agent-admin.js'
import publicOrder from './routers/public-order.js'
import storeTable from './routers/store-table.js'
import posDevice from './routers/pos-device.js'
dotenv.config()


const app: Application = express()
;(async () => {
    await connectDB()
    await ensureDefaultUnits()
    await ensureDefaultUsers()
    await migrateStoreItemAvailability()
    await migrateStoreAddonAvailability()
    const defaultStore = await Store.findOne({ code: 'main' }).select({ _id: 1 }).lean()
    if (defaultStore) {
        await ensureStoreCatalog(defaultStore._id.toString())
        await ensureStoreAddons(defaultStore._id.toString())
        await ensureStoreScopedFinancialData(defaultStore._id.toString())
    }
    app.use(cookieParser())
    const port = process.env.SERVER_BACKUP_PORT || 8080
    const allowedOrigins = Array.from(new Set([
        process.env.FRONTEND_URL || 'http://localhost:3000',
        process.env.ORDER_WEB_URL || 'http://localhost:3001',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
    ]))
    app.use(cors({
        origin: allowedOrigins,
        credentials: true,
    }))
    app.use('/api/webhook', webhook)
    app.use(bodyParser.urlencoded({ extended: false }))
    app.use(express.json())
    app.use('/api/refresh-token', refreshTokenRoutes)
    app.use('/api/auth', auth)
    app.use('/api/pos-devices', posDevice)
    app.use('/api/public', publicOrder)
    app.use('/api/items', item)
    app.use('/api/catalog-items', catalogItem)
    app.use('/api/store-items', storeItem)
    app.use('/api/orders', order)
    app.use('/api/categories', category)
    app.use('/api/stores', store)
    app.use('/api/tables', storeTable)
    app.use('/api/users', user)
    app.use('/api/expenses', expense)
    app.use('/api/units', unit)
    app.use('/api/inventory', inventory)
    app.use('/api/inventory', stocktake)
    app.use('/api/discounts', discount)
    app.use('/api/addons', addon)
    app.use('/api/store-addons', storeAddon)
    app.use('/api/other-revenues', revenue)
    app.use('/api/daily-closing', dailyClosing)
    app.use('/api/employee', employee)
    app.use('/api/shift-attendance', shiftAttendance)
    app.use('/api/print-agent', printAgent)
    app.use('/api/print-agents', printAgentAdmin)
    
    const httpServer = createServer(app)
    initializeRealtime(httpServer, allowedOrigins)
    httpServer.listen(Number(port), '0.0.0.0', () => {
        console.log(`Server is Fire at http://localhost:${port}`)
    })
})()
