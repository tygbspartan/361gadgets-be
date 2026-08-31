import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import passport from "./config/passport.config";
import { requestLogger } from "./middleware/logger.middleware";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/errorHandler.middleware";
import apiRoutes from "./routes";
import { config } from "./config/env.config";

const app: Application = express();

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

// API Routes
app.use("/api", apiRoutes);

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

export default app;
