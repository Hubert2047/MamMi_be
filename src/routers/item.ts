import { Router } from "express";
import {
  getItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem
} from "../controllers/item.js";
import authenticateToken from "../middlewares/auth.js";
import authorizationPermissions from '../middlewares/permissions.js'
import { Role } from '../constants/role.js'

const router = Router();

router.get("/",authenticateToken, getItems);        
router.get("/:id", authenticateToken, getItemById);   
router.post("/", authenticateToken, createItem);       
router.put("/:id", authenticateToken, updateItem);     
router.delete("/:id", authenticateToken, authorizationPermissions([Role.Admin, Role.SuperAdmin]), deleteItem);
export default router;
