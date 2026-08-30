import mongoose, { Schema, type Document } from 'mongoose'

export type PrinterProfile = 'kitchen-label-tspl' | 'receipt-escpos'

export interface IPrinter extends Document {
    storeId: mongoose.Types.ObjectId
    agentId: mongoose.Types.ObjectId
    name: string
    windowsPrinterName: string
    profile: PrinterProfile
    active: boolean
    printerDpi: number
    labelWidthMm: number
    labelHeightMm?: number
    labelGapMm?: number
    cutEnabled: boolean
    cutFeedHex?: string
    cutCommandHex?: string
}

const PrinterSchema = new Schema<IPrinter>({
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'PrintAgent', required: true, index: true },
    name: { type: String, required: true, trim: true },
    windowsPrinterName: { type: String, required: true, trim: true },
    profile: { type: String, enum: ['kitchen-label-tspl', 'receipt-escpos'], required: true },
    active: { type: Boolean, default: true, required: true },
    printerDpi: { type: Number, default: 203, required: true },
    labelWidthMm: { type: Number, default: 58, required: true },
    labelHeightMm: { type: Number },
    labelGapMm: { type: Number },
    cutEnabled: { type: Boolean, default: false, required: true },
    cutFeedHex: { type: String },
    cutCommandHex: { type: String },
}, { timestamps: true })

PrinterSchema.index({ storeId: 1, agentId: 1, name: 1 }, { unique: true })

export default mongoose.model<IPrinter>('Printer', PrinterSchema)
