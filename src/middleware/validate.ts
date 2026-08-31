import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { BadRequestError } from "../utils/customError.util";

// Validates & sanitises the request body against a Zod schema before the
// controller runs. On success `req.body` is replaced with the parsed (stripped)
// value — extra/unknown fields are dropped, closing mass-assignment. On failure
// a 400 with per-field errors is returned via the standard error handler.
//
// Note: only `body` is validated/reassigned — in Express 5 `req.query`/`req.params`
// are getters, so we don't overwrite them here.
export const validateBody =
  (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body ?? {});
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(
          new BadRequestError("Validation failed", err.flatten().fieldErrors),
        );
      }
      next(err);
    }
  };
