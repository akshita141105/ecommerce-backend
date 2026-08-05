// middleware/upload.js
import multer from "multer";
import cloudinary from "./cloudinary.js";

// ─── File size limits ────────────────────────
const IMAGE_LIMIT = 5 * 1024 * 1024;  // 5MB
const VIDEO_LIMIT = 50 * 1024 * 1024; // 50MB

// ─── Helpers ─────────────────────────────────
const streamUpload = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    stream.end(buffer);
  });

// Multer ko batao ki file kahan store karo (memory mein)
// aur phir manually Cloudinary pe upload karo
// const makeCloudinaryStorage = (getParams) =>
//   multer.diskStorage({
//     destination: (req, file, cb) => cb(null, ""),  // unused
//     filename: (req, file, cb) => cb(null, file.originalname),
//   });

// ─── Custom Cloudinary Storage Engine ────────
class CloudinaryEngine {
  constructor(getParams) {
    this.getParams = getParams;
  }

  async _handleFile(req, file, cb) {
    try {
      const params = await this.getParams(req, file);
      const chunks = [];
      file.stream.on("data", (chunk) => chunks.push(chunk));
      file.stream.on("end", async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const result = await streamUpload(buffer, params);
          cb(null, {
            fieldname: file.fieldname,
            originalname: file.originalname,
            mimetype: file.mimetype,
            path: result.secure_url,       // req.file.path → Cloudinary URL
            filename: result.public_id,    // req.file.filename → public_id
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

  _removeFile(req, file, cb) {
    if (file.filename) {
      cloudinary.uploader.destroy(file.filename).then(() => cb()).catch(cb);
    } else {
      cb();
    }
  }
}

// ─── File Filters ─────────────────────────────
const imageFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPG, PNG, WEBP images allowed"), false);
};

const mediaFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "video/mp4", "video/quicktime", "video/x-msvideo", "video/x-matroska",
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPG, PNG, WEBP images or MP4, MOV videos allowed"), false);
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
  storage: new CloudinaryEngine(async (req, file) => {
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