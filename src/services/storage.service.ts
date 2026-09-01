import { createClient } from "@supabase/supabase-js";
import { promises as fs, constants as fsConstants } from "fs";
import path from "path";
import { config } from "../config/env.config";

// Entity folders images are grouped under. Matches this repo's uploadable entities.
export type UploadFolder = "products" | "brands" | "categories" | "hero" | "vendors";

// One interface, two implementations (Supabase / local disk). Call sites only
// ever touch the resolved `StorageService` at the bottom of this file — they
// never import a concrete implementation or branch on environment.
export interface IStorageService {
  /** Store an image and return its absolute public URL (what gets persisted). */
  uploadImage(file: Express.Multer.File, folder?: UploadFolder): Promise<string>;
  deleteImage(publicUrl: string): Promise<void>;
  deleteImages(publicUrls: string[]): Promise<void>;
  /** Parse a public URL back into a storage path; null for foreign/CDN URLs. */
  extractPath(publicUrl: string): string | null;
  /** Readiness probe (used by /health/ready). Throws if storage is unusable. */
  healthCheck(): Promise<void>;
}

const extOf = (file: Express.Multer.File): string =>
  file.originalname.split(".").pop()?.toLowerCase() || "jpg";

const randomName = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ── Supabase Storage (development) ──────────────────────────────────────────
const BUCKET = config.supabaseStorageBucket;
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

const SupabaseStorageService: IStorageService = {
  async uploadImage(file, folder = "products") {
    const name = `${folder}/${randomName()}.${extOf(file)}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(name, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) {
      throw new Error(`Image upload failed: ${error.message}`);
    }
    return supabase.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
  },

  async deleteImage(publicUrl) {
    const key = this.extractPath(publicUrl);
    if (!key) return; // foreign/external URL — ignore, don't crash
    await supabase.storage.from(BUCKET).remove([key]);
  },

  async deleteImages(publicUrls) {
    const keys = publicUrls
      .map((u) => this.extractPath(u))
      .filter((p): p is string => p !== null);
    if (keys.length === 0) return;
    await supabase.storage.from(BUCKET).remove(keys);
  },

  extractPath(publicUrl) {
    try {
      const marker = `/object/public/${BUCKET}/`;
      const idx = publicUrl.indexOf(marker);
      if (idx === -1) return null;
      return publicUrl.slice(idx + marker.length);
    } catch {
      return null;
    }
  },

  async healthCheck() {
    const { error } = await supabase.storage.from(BUCKET).list("", { limit: 1 });
    if (error) {
      throw new Error(`Storage unreachable: ${error.message}`);
    }
  },
};

// ── Local disk (production) ─────────────────────────────────────────────────
const UPLOAD_DIR = path.resolve(config.uploadDir);
const PUBLIC_PREFIX = "/uploads"; // matches the express.static mount in app.ts

// Resolve a storage key to an absolute path, refusing anything that escapes
// UPLOAD_DIR (defence-in-depth against path traversal via a crafted URL).
function safeLocalPath(key: string): string | null {
  const dest = path.resolve(UPLOAD_DIR, key);
  if (dest !== UPLOAD_DIR && !dest.startsWith(UPLOAD_DIR + path.sep)) return null;
  return dest;
}

const LocalStorageService: IStorageService = {
  async uploadImage(file, folder = "products") {
    const filename = `${randomName()}.${extOf(file)}`;
    await fs.mkdir(path.join(UPLOAD_DIR, folder), { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, folder, filename), file.buffer);
    return `${config.publicBaseUrl}${PUBLIC_PREFIX}/${folder}/${filename}`;
  },

  async deleteImage(publicUrl) {
    const key = this.extractPath(publicUrl);
    if (!key) return;
    const dest = safeLocalPath(key);
    if (!dest) return;
    try {
      await fs.unlink(dest);
    } catch {
      /* already gone / never existed — silently ignore */
    }
  },

  async deleteImages(publicUrls) {
    await Promise.all(publicUrls.map((u) => this.deleteImage(u)));
  },

  extractPath(publicUrl) {
    try {
      const marker = `${PUBLIC_PREFIX}/`;
      const idx = publicUrl.indexOf(marker);
      if (idx === -1) return null;
      return publicUrl.slice(idx + marker.length);
    } catch {
      return null;
    }
  },

  async healthCheck() {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.access(UPLOAD_DIR, fsConstants.W_OK);
  },
};

// Resolved once at module load. This is the ONLY export call sites use.
export const StorageService: IStorageService =
  config.nodeEnv === "production" ? LocalStorageService : SupabaseStorageService;
