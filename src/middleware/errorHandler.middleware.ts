import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.util";

interface CustomError extends Error {
  statusCode?: number;
  errors?: any;
  code?: string; // Prisma error code, when present
}

// Prisma transient contention errors — the request never did any work and can
// safely be retried by the client, so we present them as a 503 (busy) rather
// than a 500 (broken). P2028: couldn't start a transaction in time (pool
// exhausted). P2034: transaction write-conflict / deadlock.
const TRANSIENT_PRISMA_CODES = new Set(["P2028", "P2034"]);

export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  if (err.code && TRANSIENT_PRISMA_CODES.has(err.code)) {
    statusCode = 503;
    message = "The server is busy right now. Please try again in a moment.";
    res.setHeader("Retry-After", "2");
  }

  const requestId = (req as any).id as string | undefined;

  // Server errors (5xx) are unexpected — log with the stack. Client errors (4xx)
  // are expected and logged at warn without a stack.
  const logPayload = {
    reqId: requestId,
    method: req.method,
    path: req.path,
    status: statusCode,
    err: statusCode >= 500 ? err : { message },
  };
  if (statusCode >= 500) {
    logger.error(logPayload, "unhandled error");
  } else {
    logger.warn(logPayload, "request error");
  }

  res.status(statusCode).json({
    status: "error",
    message,
    requestId,
    ...(process.env.NODE_ENV === "development" && {
      errors: err.errors,
    }),
  });
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    status: "error",
    message: `Route ${req.originalUrl} not found`,
    requestId: (req as any).id,
  });
};
