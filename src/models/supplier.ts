import mongoose, { Schema, type Document } from 'mongoose'

export interface ISupplier extends Document {
    storeId: mongoose.Types.ObjectId
    name: string
    contactPerson?: string
    phone?: string
    address?: string
    note?: string
    lineGroupId?: mongoose.Types.ObjectId
    active: boolean
    createdAt: Date
    updatedAt: Date
}

const SupplierSchema = new Schema<ISupplier>({
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    name: { type: String, required: true, trim: true },
    contactPerson: String,
    phone: String,
    address: String,
    note: String,
    lineGroupId: { type: Schema.Types.ObjectId, ref: 'LineGroup' },
    active: { type: Boolean, default: true },
}, { timestamps: true })

SupplierSchema.index({ storeId: 1, name: 1 }, { unique: true })

export default mongoose.model<ISupplier>('Supplier', SupplierSchema)
