import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../utils/logger.util";

const SENSITIVE_PARAMS = ["token", "reset_token", "access_token", "code"];

function scrubUrl(url: string): string {
  try {
    const [path, qs] = url.split("?");
    if (!qs) return url;
    const scrubbed = qs
      .split("&")
      .map((part) => {
        const [key] = part.split("=");
        return SENSITIVE_PARAMS.includes(key.toLowerCase()) ? `${key}=[REDACTED]` : part;
      })
      .join("&");
    return `${path}?${scrubbed}`;
  } catch {
    return url;
  }
}

// Assigns each request a correlation id (honouring an inbound X-Request-Id so a
// gateway/frontend can thread it through), echoes it back on the response, and
// logs a single structured line per request. The id is read by the error handler
// so a client-facing error can be tied back to its server log.
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const incoming = req.headers["x-request-id"];
  const requestId =
    (Array.isArray(incoming) ? incoming[0] : incoming) || crypto.randomUUID();

  (req as any).id = requestId;
  res.setHeader("X-Request-Id", requestId);

  const start = Date.now();

  res.on("finish", () => {
    // Health/readiness probes fire constantly (load balancers, uptime checks) —
    // don't log the successful ones, they're pure noise. (originalUrl is stable
    // here; req.path can be rewritten by sub-routers before 'finish' fires.)
    const pathname = req.originalUrl.split("?")[0];
    if (
      res.statusCode < 400 &&
      (pathname === "/api/health" || pathname === "/api/health/ready")
    ) {
      return;
    }

    const duration = Date.now() - start;
    const payload = {
      reqId: requestId,
      method: req.method,
      url: scrubUrl(req.originalUrl),
      status: res.statusCode,
      durationMs: duration,
    };

    if (res.statusCode >= 500) {
      logger.error(payload, "request failed");
    } else if (res.statusCode >= 400) {
      logger.warn(payload, "request client error");
    } else if (duration > 1000) {
      logger.warn(payload, "slow request");
    } else {
      logger.info(payload, "request");
    }
  });

  next();
};
