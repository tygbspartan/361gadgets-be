import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import passport from "./config/passport.config";
import { requestLogger } from "./middleware/logger.middleware";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/errorHandler.middleware";
import apiRoutes from "./routes";
import { config } from "./config/env.config";

const app: Application = express();

// Behind a reverse proxy in production — trust the first hop so client IPs
// (used by rate limiting) and protocol are read from X-Forwarded-* correctly.
if (config.nodeEnv === "production") {
  app.set("trust proxy", 1);
}

// Security headers — CSP and COEP disabled to avoid breaking OAuth redirects and API clients
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Middleware
// Explicit CORS allowlist from env (never "*" or a reflected origin). Requests
// with no Origin header (curl, server-to-server, health checks) are allowed.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "500kb" }));
app.use(express.urlencoded({ extended: true, limit: "500kb" }));
app.use(requestLogger);

// Initialize Passport
app.use(passport.initialize());

// Serve locally-stored uploads in production (the local-disk storage driver).
// The CORP header is required: helmet's default same-origin CORP makes the
// browser block these images from the separate-origin storefront. Scoped to
// /uploads so API responses keep the stricter default.
if (config.nodeEnv === "production") {
  app.use(
    "/uploads",
    (_req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(path.resolve(config.uploadDir)),
  );
}

// API Routes
app.use("/api", apiRoutes);

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

export default app;
