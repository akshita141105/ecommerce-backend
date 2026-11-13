// config/multer.ts
import type { Request } from "express";
import multer, { type StorageEngine } from "multer";
import cloudinary from "./cloudinary.js";
import type { UploadApiOptions, UploadApiResponse } from "cloudinary";

// ─── File size limits ────────────────────────
const IMAGE_LIMIT = 5 * 1024 * 1024; // 5MB
const VIDEO_LIMIT = 50 * 1024 * 1024; // 50MB

// ─── Helpers ─────────────────────────────────
const streamUpload = (buffer: Buffer, options: UploadApiOptions): Promise<UploadApiResponse> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err);
      else resolve(result as UploadApiResponse);
    });
    stream.end(buffer);
  });

type GetParams = (req: Request, file: Express.Multer.File) => Promise<UploadApiOptions>;

// ─── Custom Cloudinary Storage Engine ────────
class CloudinaryEngine implements StorageEngine {
  private getParams: GetParams;

  constructor(getParams: GetParams) {
    this.getParams = getParams;
  }

  async _handleFile(
    req: Request,
    file: Express.Multer.File,
    cb: (error?: unknown, info?: Partial<Express.Multer.File>) => void
  ) {
    try {
      const params = await this.getParams(req, file);
      const chunks: Buffer[] = [];
      file.stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      file.stream.on("end", async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const result = await streamUpload(buffer, params);
          cb(null, {
            fieldname: file.fieldname,
            originalname: file.originalname,
            mimetype: file.mimetype,
            path: result.secure_url, // req.file.path → Cloudinary URL
            filename: result.public_id, // req.file.filename → public_id
            size: result.bytes,
          });
        } catch (err) {
          cb(err);
        }
      });
      file.stream.on("error", cb);
    } catch (err) {
      cb(err);
    }
  }

  _removeFile(_req: Request, file: Express.Multer.File, cb: (error: Error | null) => void) {
    if (file.filename) {
      cloudinary.uploader
        .destroy(file.filename)
        .then(() => cb(null))
        .catch(cb);
    } else {
      cb(null);
    }
  }
}

// ─── File Filters ─────────────────────────────
const imageFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPG, PNG, WEBP images allowed"));
};

const mediaFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const allowed = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPG, PNG, WEBP images or MP4, MOV videos allowed"));
};

/* ----------------------------
   CATEGORY IMAGE
----------------------------- */
export const uploadCategoryImage = multer({
  storage: new CloudinaryEngine(async () => ({
    folder: "categories",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 800, height: 800, crop: "limit", quality: "auto" }],
  })),
  limits: { fileSize: IMAGE_LIMIT },
  fileFilter: imageFilter,
});

/* ----------------------------
   SUBCATEGORY IMAGE
----------------------------- */
export const uploadSubCategoryImage = multer({
  storage: new CloudinaryEngine(async () => ({
    folder: "subcategories",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 800, height: 800, crop: "limit", quality: "auto" }],
  })),
  limits: { fileSize: IMAGE_LIMIT },
  fileFilter: imageFilter,
});

/* ----------------------------
   PRODUCT IMAGES + VIDEO
----------------------------- */
export const uploadProductMedia = multer({
  storage: new CloudinaryEngine(async (_req, file) => {
    if (file.mimetype.startsWith("video")) {
      return {
        folder: "product-videos",
        resource_type: "video",
        allowed_formats: ["mp4", "mov", "avi", "mkv"],
      };
    }
    return {
      folder: "products",
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      transformation: [{ width: 1200, height: 1200, crop: "limit", quality: "auto" }],
    };
  }),
  limits: { fileSize: VIDEO_LIMIT, files: 15 },
  fileFilter: mediaFilter,
});

/* ----------------------------
   PROMO BANNER IMAGE
----------------------------- */
export const uploadPromoBannerImage = multer({
  storage: new CloudinaryEngine(async () => ({
    folder: "promo-banners",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 1080, height: 1920, crop: "limit", quality: "auto" }],
  })),
  limits: { fileSize: IMAGE_LIMIT },
  fileFilter: imageFilter,
});
