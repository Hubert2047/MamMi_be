import { randomBytes } from 'node:crypto'
import mongoose, { Schema, type Document } from 'mongoose'

export type GuestCartLine = { itemId: string; quantity: number; variant?: string; noteOptions: string[]; addonIds: string[]; note?: string }
export type GuestCartSource = 'qr' | 'online'
export type GuestCartType = 'dine_in' | 'takeaway'
export type GuestCartCustomer = { name?: string; phone?: string; address?: string }
export interface IGuestCart extends Document { cartToken: string; storeId: mongoose.Types.ObjectId; source: GuestCartSource; type: GuestCartType; table: string; customer?: GuestCartCustomer; lines: GuestCartLine[]; status: 'draft' | 'confirming' | 'confirmed'; orderId?: mongoose.Types.ObjectId; expiresAt: Date }
const GuestCartLineSchema = new Schema<GuestCartLine>({ itemId: { type: String, required: true }, quantity: { type: Number, required: true }, variant: String, noteOptions: { type: [String], default: [] }, addonIds: { type: [String], default: [] }, note: String }, { _id: false })
const GuestCartSchema = new Schema<IGuestCart>({ cartToken: { type: String, required: true, unique: true, default: () => randomBytes(24).toString('base64url') }, storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true }, source: { type: String, enum: ['qr', 'online'], default: 'qr', required: true }, type: { type: String, enum: ['dine_in', 'takeaway'], default: 'dine_in', required: true }, table: { type: String, default: '' }, customer: { name: String, phone: String, address: String }, lines: { type: [GuestCartLineSchema], default: [] }, status: { type: String, enum: ['draft', 'confirming', 'confirmed'], default: 'draft' }, orderId: { type: Schema.Types.ObjectId, ref: 'Order' }, expiresAt: { type: Date, required: true } }, { timestamps: true })
GuestCartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export default mongoose.model<IGuestCart>('GuestCart', GuestCartSchema)
