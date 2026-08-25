import mongoose, { Schema, Document } from 'mongoose'

export const PAYMENT_METHODS = ['cash', 'uber', 'linepay', 'bank', 'foodpanda'] as const
export interface OrderItemAddon {
    id: string
    name: string
    priceExtra: number
    amount: number
    printName?: string
}
interface OrderItem {
    id: mongoose.Types.ObjectId
    itemId: string
    name: string
    quantity: number
    basePrice: number
    variant: string
    addons: OrderItemAddon[]
    noteOptions: string[]
    note: string
    printName?: string
    printVariant?: string
    printAddons?: OrderItemAddon[]
    printNoteOptions?: string[]
}

export interface OrderDiscount {
    name: string
    amount: number
    type: 'percent' | 'value'
}
interface Customer {
    name?: string
    phone?: string
    address?: string
}
export interface IOrder extends Document {
    storeId: mongoose.Types.ObjectId
    /** Legacy field retained for old records and existing clients. New orders set it to sequence. */
    number: number
    /** Counter scope. Old orders may not have these fields until migrated/backfilled. */
    periodId?: string
    sequence?: number
    items: OrderItem[]
    totalPrice: number
    status: 'pending' | 'paid' | 'cancelled'
    paidAt?: Date
    type: 'dine_in' | 'takeaway' | 'uber' | 'foodpanda'
    discount?: OrderDiscount
    paymentMethod: string
    customer: Customer | null
    table?: string
    source: 'pos' | 'qr' | 'online' | 'uber' | 'foodpanda'
    externalOrderId?: string
    version: number
}
const CustomerSchema = new Schema<Customer>(
    {
        name: String,
        phone: String,
        address: String,
    },
    { _id: false },
)

const OrderItemAddonSchema = new Schema<OrderItemAddon>(
    {
        id: String,
        name: String,
        priceExtra: Number,
        amount: Number,
    },
    { _id: false },
)
const OrderDiscountSchema = new Schema<OrderDiscount>(
    {
        name: { type: String },
        type: {
            type: String,
            enum: ['percent', 'value'],
        },
        amount: { type: Number },
    },
    { _id: false },
)
const OrderItemSchema = new Schema<OrderItem>(
    {
        id: Schema.Types.ObjectId,
        itemId: String,
        name: String,
        quantity: { type: Number, default: 1 },
        basePrice: Number,
        variant: String,
        addons: [OrderItemAddonSchema],
        noteOptions: [String],
        note: String,
        printName: String,
        printVariant: String,
        printAddons: [OrderItemAddonSchema],
        printNoteOptions: [String],
    },
    { _id: false },
)

const OrderSchema = new Schema<IOrder>(
    {
        storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
        number: { type: Number, required: true },
        periodId: { type: String },
        sequence: { type: Number },
        items: [OrderItemSchema],
        totalPrice: { type: Number, required: true },
        paidAt: { type: Date },
        status: {
            type: String,
            enum: ['pending', 'paid', 'cancelled'],
            default: 'pending',
        },
        type: {
            type: String,
            enum: ['dine_in', 'takeaway', 'uber', 'foodpanda'],
            default: 'dine_in',
        },
        discount: {
            type: OrderDiscountSchema,
            default: null,
        },
        paymentMethod: {
            type: String,
            enum: PAYMENT_METHODS,
            required: true,
        },
        customer: {
            type: CustomerSchema,
            default: null,
        },
        table: { type: String, trim: true },
        source: { type: String, enum: ['pos', 'qr', 'online', 'uber', 'foodpanda'], default: 'pos', required: true },
        externalOrderId: String,
        version: { type: Number, default: 1, required: true },
    },
    { timestamps: true },
)

OrderSchema.index({ storeId: 1, createdAt: -1 })
OrderSchema.index({ storeId: 1, status: 1, createdAt: -1 })
OrderSchema.index({ storeId: 1, status: 1, paidAt: -1 })
OrderSchema.index(
    { storeId: 1, periodId: 1, sequence: 1 },
    { unique: true, partialFilterExpression: { periodId: { $type: 'string' }, sequence: { $type: 'number' } } },
)
OrderSchema.index(
    { storeId: 1, source: 1, externalOrderId: 1 },
    { unique: true, partialFilterExpression: { externalOrderId: { $type: 'string' } } },
)

export default mongoose.model<IOrder>('Order', OrderSchema)
