import bodyParser from 'body-parser'
import dotenv from 'dotenv'
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
import cookieParser from 'cookie-parser'
import webhook from './routers/webhook.js'
import { ensureDefaultUsers } from './controllers/auth.js'
import Store from './models/store.js'
import { ensureStoreAddons, ensureStoreCatalog, ensureStoreScopedFinancialData } from './services/storeCatalogMigration.js'
dotenv.config()


const app: Application = express()
;(async () => {
    await connectDB()
    await ensureDefaultUsers()
    const defaultStore = await Store.findOne({ code: 'main' }).select({ _id: 1 }).lean()
    if (defaultStore) {
        await ensureStoreCatalog(defaultStore._id.toString())
        await ensureStoreAddons(defaultStore._id.toString())
        await ensureStoreScopedFinancialData(defaultStore._id.toString())
    }
    app.use(cookieParser())
    const port = process.env.SERVER_BACKUP_PORT || 8080
    app.use(cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
    }))
    app.use('/api/webhook', webhook)
    app.use(bodyParser.urlencoded({ extended: false }))
    app.use(express.json())
    app.use('/api/refresh-token', refreshTokenRoutes)
    app.use('/api/auth', auth)
    app.use('/api/items', item)
    app.use('/api/catalog-items', catalogItem)
    app.use('/api/store-items', storeItem)
    app.use('/api/orders', order)
    app.use('/api/categories', category)
    app.use('/api/expenses', expense)
    app.use('/api/discounts', discount)
    app.use('/api/addons', addon)
    app.use('/api/store-addons', storeAddon)
    app.use('/api/other-revenues', revenue)
    app.use('/api/daily-closing', dailyClosing)
    app.use('/api/employee', employee)
    app.use('/api/shift-attendance', shiftAttendance)
    
    app.listen(port, () => {
        console.log(`Server is Fire at http://localhost:${port}`)
    })
})()
