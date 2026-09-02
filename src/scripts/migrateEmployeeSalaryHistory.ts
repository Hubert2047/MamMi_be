import 'dotenv/config'
import mongoose from 'mongoose'
import Employee from '../models/employee.js'
import EmployeeSalaryHistory from '../models/employee-salary-history.js'

const uri = process.env.MONGO_URI
if (!uri) throw new Error('MONGO_URI not set')

await mongoose.connect(uri, { dbName: 'mammi' })
const employees = await Employee.find().lean()
let created = 0
for (const employee of employees) {
    const exists = await EmployeeSalaryHistory.exists({ employeeId: employee._id })
    if (exists) continue
    await EmployeeSalaryHistory.create({
        employeeId: employee._id,
        salaryType: employee.salaryType || 'hourly',
        amount: employee.salaryAmount ?? 0,
        currency: 'TWD',
        effectiveFrom: employee.startDate || (employee as any).createdAt || new Date(),
        reason: 'Initial salary history migration',
    })
    created++
}
console.log(`Created ${created} initial employee salary history records`)
await mongoose.disconnect()
