import mongoose, { Schema, Document } from 'mongoose'

export interface IEmployee extends Document {
    name: string
    numberId: string
    note: string
    active: boolean
    employmentType: 'official' | 'part_time'
    role: 'manager' | 'employee'
    salaryType: 'monthly' | 'hourly'
    salaryAmount: number
    startDate: Date
    endDate?: Date
    storeId: mongoose.Types.ObjectId
}

const EmployeeSchema = new Schema<IEmployee>(
    {
        name: { type: String, required: true },
        numberId: { type: String, required: true, unique: true },
        note: String,
        active: { type: Boolean, default: true, required: true },
        employmentType: { type: String, enum: ['official', 'part_time'], default: 'official', required: true },
        role: { type: String, enum: ['manager', 'employee'], default: 'employee', required: true },
        salaryType: { type: String, enum: ['monthly', 'hourly'], default: 'hourly', required: true },
        salaryAmount: { type: Number, min: 0, default: 0, required: true },
        startDate: { type: Date, default: Date.now, required: true },
        endDate: { type: Date },
        storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    },
    { timestamps: true },
)

export default mongoose.model<IEmployee>('Employee', EmployeeSchema)
