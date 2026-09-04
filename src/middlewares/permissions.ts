import type { NextFunction, Response } from "express";
import type { Role } from "./auth.js";
export default function authorizationPermissions(roles: Role[]) {
  return (req: any, res: Response, next: NextFunction) => {
    // `roles` argument is an array of roles
    // We check whether user authenticated or not.
    // If user authenticated, `req.user` will be object otherwise it will be `undefined`
    if (req.user) {
      // `req.user` is a user object from Database
      // Checking whether `req.user` has a corresponded role
      if (roles.indexOf(req.user.role) !== -1)
        next(); // `req.user.role` is string and it may be "admin", "superadmin", or "guest"
      else res.status(403).send({ message: "unauthorized" });
    } else {
      res.status(401).send({ message: "unauthorized" });
    }
  };
}
