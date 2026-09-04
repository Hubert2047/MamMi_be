import type { Request, Response } from "express";
import Employee from "../models/employee.js";
import EmployeeSalaryHistory from "../models/employee-salary-history.js";
import { type AuthRequest } from "../middlewares/auth.js";

const storeIdFor = (req: Request) => (req as AuthRequest).user.storeId;
const employeeNumberPattern = /^\d{4}$/;

const isValidEmployeeNumber = (value: unknown): value is string =>
  typeof value === "string" && employeeNumberPattern.test(value);

export const createEmployee = async (req: Request, res: Response) => {
  try {
    const {
      name,
      numberId,
      note,
      active,
      employmentType,
      role,
      salaryType,
      salaryAmount,
      startDate,
      endDate,
    } = req.body;
    const storeId = storeIdFor(req);
    if (!isValidEmployeeNumber(numberId)) {
      return res
        .status(400)
        .json({
          success: false,
          code: "EMPLOYEE_NUMBER_ID_INVALID",
          message: "Employee number ID must contain exactly 4 digits",
        });
    }
    const employee = await Employee.findOne({ numberId });
    if (employee) {
      return res
        .status(400)
        .json({ success: false, message: "Employee already exists" });
    }
    const newEmployee = new Employee({
      name,
      numberId,
      note,
      active,
      employmentType,
      role,
      salaryType,
      salaryAmount,
      startDate,
      endDate,
      storeId,
    });
    await newEmployee.save();
    await EmployeeSalaryHistory.create({
      employeeId: newEmployee._id,
      salaryType: newEmployee.salaryType,
      amount: newEmployee.salaryAmount,
      currency: "TWD",
      effectiveFrom: newEmployee.startDate,
    });
    res.status(201).json({ success: true, data: newEmployee });
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      return res
        .status(400)
        .json({ success: false, message: "Employee already exists" });
    }
    res
      .status(500)
      .json({ success: false, message: "Error creating Employee", error });
  }
};
export const serverCreateEmployee = async (
  name: string,
  numberId: string,
  note: string,
) => {
  try {
    const employee = await Employee.findOne({ numberId });
    if (employee) return;

    const newEmployee = new Employee({ name, numberId, note, active: true });
    await newEmployee.save();
  } catch (error) {
    console.log("Error creating Employee", error);
  }
};

export const getEmployees = async (req: Request, res: Response) => {
  try {
    const employees = await Employee.find({ storeId: storeIdFor(req) }).sort({
      createdAt: -1,
    });
    res.json({ success: true, data: employees });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching Employee", error });
  }
};
export const deleteEmployee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const employee = await Employee.findOneAndDelete({
      _id: String(id),
      storeId: storeIdFor(req),
    } as any);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    res.json({
      success: true,
      message: "Employee deleted successfully",
      data: employee,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting Employee",
      error,
    });
  }
};

export const updateEmployee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Thiếu id",
      });
    }

    const {
      name,
      numberId,
      note,
      active,
      employmentType,
      role,
      salaryType,
      salaryAmount,
      startDate,
      endDate,
      salaryEffectiveFrom,
      salaryChangeReason,
    } = data;
    const current = await Employee.findOne({
      _id: String(id),
      storeId: storeIdFor(req),
    } as any);
    if (!current) {
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    }
    if (!isValidEmployeeNumber(numberId)) {
      return res
        .status(400)
        .json({
          success: false,
          code: "EMPLOYEE_NUMBER_ID_INVALID",
          message: "Employee number ID must contain exactly 4 digits",
        });
    }

    const update: any = {
      $set: {
        name,
        numberId,
        note,
        active,
        employmentType,
        role,
        salaryType,
        salaryAmount,
        startDate,
      },
    };
    if (active) update.$unset = { endDate: 1 };
    else update.$set.endDate = endDate || new Date();

    const updated = await Employee.findOneAndUpdate(
      { _id: String(id), storeId: storeIdFor(req) } as any,
      update,
      {
        returnDocument: "after",
        runValidators: true,
      },
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy Employee",
      });
    }

    if (
      current.salaryType !== updated.salaryType ||
      current.salaryAmount !== updated.salaryAmount
    ) {
      const effectiveFrom = salaryEffectiveFrom
        ? new Date(salaryEffectiveFrom)
        : new Date();
      await EmployeeSalaryHistory.updateMany(
        { employeeId: updated._id, effectiveTo: { $exists: false } },
        { $set: { effectiveTo: effectiveFrom } },
      );
      await EmployeeSalaryHistory.create({
        employeeId: updated._id,
        salaryType: updated.salaryType,
        amount: updated.salaryAmount,
        currency: "TWD",
        effectiveFrom,
        reason: salaryChangeReason,
      });
    }

    return res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error updating Employee",
      error,
    });
  }
};

export const getEmployeeSalaryHistory = async (req: Request, res: Response) => {
  try {
    const employee = await Employee.findOne({
      _id: String(req.params.id),
      storeId: storeIdFor(req),
    } as any)
      .select({ _id: 1 })
      .lean();
    if (!employee)
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    const history = await EmployeeSalaryHistory.find({
      employeeId: employee._id,
    })
      .sort({ effectiveFrom: -1 })
      .lean();
    return res.json({ success: true, data: history });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Error fetching salary history",
        error,
      });
  }
};
