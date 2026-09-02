import mongoose, { Document, Schema } from 'mongoose'

export interface IEmployeeSalaryHistory extends Document {
    employeeId: mongoose.Types.ObjectId
    salaryType: 'monthly' | 'hourly'
    amount: number
    currency: string
    effectiveFrom: Date
    effectiveTo?: Date
    reason?: string
}

const EmployeeSalaryHistorySchema = new Schema<IEmployeeSalaryHistory>(
    {
        employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
        salaryType: { type: String, enum: ['monthly', 'hourly'], required: true },
        amount: { type: Number, min: 0, required: true },
        currency: { type: String, default: 'TWD', required: true },
        effectiveFrom: { type: Date, required: true },
        effectiveTo: { type: Date },
        reason: { type: String },
    },
    { timestamps: true },
)

EmployeeSalaryHistorySchema.index({ employeeId: 1, effectiveFrom: -1 })

export default mongoose.model<IEmployeeSalaryHistory>('EmployeeSalaryHistory', EmployeeSalaryHistorySchema)
