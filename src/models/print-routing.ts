import mongoose, { Schema, type Document } from 'mongoose'
export interface IPrintRouting extends Document { storeId: mongoose.Types.ObjectId; kitchenPrinterId?: mongoose.Types.ObjectId; receiptPrinterId?: mongoose.Types.ObjectId; fapiaoPrinterId?: mongoose.Types.ObjectId }
const PrintRoutingSchema = new Schema<IPrintRouting>({ storeId: { type: Schema.Types.ObjectId, ref: 'Store', unique: true, required: true }, kitchenPrinterId: { type: Schema.Types.ObjectId, ref: 'Printer' }, receiptPrinterId: { type: Schema.Types.ObjectId, ref: 'Printer' }, fapiaoPrinterId: { type: Schema.Types.ObjectId, ref: 'Printer' } }, { timestamps: true })
export default mongoose.model<IPrintRouting>('PrintRouting', PrintRoutingSchema)
