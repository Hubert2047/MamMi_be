import dotenv from 'dotenv'
import mongoose from 'mongoose'
import type { Collection } from 'mongodb'
import { fromZonedTime } from 'date-fns-tz'

dotenv.config()

const TIME_ZONE = 'Asia/Taipei'

function getPeriodStart(createdAt: Date): Date {
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(createdAt)
    return fromZonedTime(`${localDate}T00:00:00`, TIME_ZONE)
}

async function sumByCreatedAt(collection: Collection, start: Date, end: Date, field: string): Promise<number> {
    const result = await collection.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: `$${field}` } } },
    ]).toArray()
    return Number(result[0]?.total ?? 0)
}

async function migrate(): Promise<void> {
    const uri = process.env.MONGO_URI
    if (!uri) throw new Error('MONGO_URI is required')

    await mongoose.connect(uri, { dbName: 'mammi' })
    const db = mongoose.connection.db
    if (!db) throw new Error('MongoDB database is not available')

    const dailyClosings = db.collection('dailyclosings')
    const orders = db.collection('orders')
    const revenues = db.collection('revenues')
    const expenses = db.collection('expenses')
    const legacyClosings = await dailyClosings.find({ status: { $exists: false } }).sort({ createdAt: 1, _id: 1 }).toArray()
    let previousClosingAmount = 0

    for (const closing of legacyClosings) {
        const periodEnd = new Date(closing.createdAt)
        const periodStart = getPeriodStart(periodEnd)
        const sales = await orders.aggregate([
            { $match: { status: 'paid', paidAt: { $gte: periodStart, $lte: periodEnd } } },
            { $group: { _id: null, total: { $sum: '$totalPrice' } } },
        ]).toArray()
        const cashSales = await orders.aggregate([
            { $match: { status: 'paid', paymentMethod: 'cash', paidAt: { $gte: periodStart, $lte: periodEnd } } },
            { $group: { _id: null, total: { $sum: '$totalPrice' } } },
        ]).toArray()
        const otherRevenueTotal = await sumByCreatedAt(revenues, periodStart, periodEnd, 'price')
        const expensesTotal = await sumByCreatedAt(expenses, periodStart, periodEnd, 'price')
        const actualTotal = Number(closing.actualTotal ?? 0)
        const systemAmount = Number(closing.systemAmount ?? previousClosingAmount + Number(sales[0]?.total ?? 0) + otherRevenueTotal - expensesTotal)

        await dailyClosings.updateOne(
            { _id: closing._id, status: { $exists: false } },
            {
                $set: {
                    periodStart,
                    periodEnd,
                    status: 'confirmed',
                    previousClosingAmount,
                    cashSales: Number(cashSales[0]?.total ?? 0),
                    otherRevenueTotal,
                    expensesTotal,
                    difference: actualTotal - systemAmount,
                    confirmedAt: periodEnd,
                    confirmedBy: 'migration',
                },
            },
        )
        previousClosingAmount = actualTotal
    }

    const indexes = await dailyClosings.listIndexes().toArray()
    if (indexes.some((index) => index.name === 'closingDay_1')) {
        await dailyClosings.dropIndex('closingDay_1')
    }
    await dailyClosings.createIndex({ createdAt: 1 })
    await dailyClosings.createIndex({ status: 1, periodEnd: -1 })
    await dailyClosings.createIndex({ status: 1, periodStart: 1, periodEnd: 1 })

    console.log(`Migrated ${legacyClosings.length} daily closing records`)
}

migrate()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await mongoose.disconnect()
    })
