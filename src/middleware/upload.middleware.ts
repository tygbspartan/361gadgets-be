import multer from "multer";
import { fromBuffer } from "file-type";
import sharp from "sharp";
import { Request, Response, NextFunction } from "express";
import { BadRequestError } from "../utils/customError.util";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_FILES = 1; // every upload route uses upload.single(...)
const MAX_DIMENSION = 2000; // px — cap the longest edge

// sharp re-encodes these (which drops EXIF/metadata and caps dimensions).
// Animated GIFs are passed through untouched to avoid flattening the animation.
const REPROCESSABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    // Header-level check — client-reported MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new BadRequestError("Only JPEG, PNG, WebP, and GIF images are allowed") as any);
    }
    cb(null, true);
  },
});

// Runs after multer. Validates the real file bytes (not just the Content-Type
// header), then strips metadata (EXIF) and caps dimensions by re-encoding through
// sharp. Mutates each file's buffer/size in place so downstream upload uses the
// sanitised image.
export async function validateImageBuffer(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files: Express.Multer.File[] = req.file
      ? [req.file]
      : Array.isArray(req.files)
      ? (req.files as Express.Multer.File[])
      : Object.values(req.files ?? {}).flat();

    for (const file of files) {
      const detected = await fromBuffer(file.buffer);
      if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime)) {
        return next(new BadRequestError("Uploaded file is not a valid image"));
      }

      if (REPROCESSABLE.has(detected.mime)) {
        // .rotate() bakes in EXIF orientation before metadata is dropped; sharp
        // strips all other metadata by default. fit:"inside" + withoutEnlargement
        // caps the longest edge without upscaling small images.
        const processed = await sharp(file.buffer, { failOn: "none" })
          .rotate()
          .resize({
            width: MAX_DIMENSION,
            height: MAX_DIMENSION,
            fit: "inside",
            withoutEnlargement: true,
          })
          .toBuffer();

        file.buffer = processed;
        file.size = processed.length;
      }
    }
    next();
  } catch {
    next(new BadRequestError("Could not process uploaded file"));
  }
}
