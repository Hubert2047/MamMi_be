import mongoose from 'mongoose'
import Category from '../models/category.js'

export async function connectDB(): Promise<void> {
    console.log('start connect db ...')
    const uri = process.env.MONGO_URI
    if (!uri) {
        throw new Error('MONGO_URI not set in .env')
    }

    try {
        await mongoose.connect(uri, { dbName: 'mammi' })
        // Remove indexes from the old single-name category schema (for example name_1).
        await Category.syncIndexes()
        console.log('Connected to MongoDB')
    } catch (err) {
        console.error('MongoDB connection error:', err)
        process.exit(1)
    }
}
