// controllers/admin/bulkUploadController.js
import csv from "csv-parser";
import crypto from "crypto";
import { Readable } from "stream";
import logger from "../../utils/logger.js";
import { getImageSessionMappings } from "../../utils/bulkUploadQueue.js";

import {
  queueBulkUpload,
  getBulkUploadGroupStatus,
  csvRowToProduct,
  saveImageSessionMappings,
  resolveProductImages,
} from "../../utils/bulkUploadQueue.js";

import * as XLSX from "xlsx";

// ─── Parse XLSX buffer to raw rows (same shape as parseCSV) ──
const parseXLSX = (buffer) => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  // defval: "" ensures empty cells come as "" instead of being skipped
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows;
};

// -------------------------------------------
// CSV FORMAT:
// name,price,subcategorySlug,description,details,offer,newArrival,colors
//
// colors format (JSON string) — images can be either full URLs OR just
// filenames (e.g. "shirt-white-1.jpg") that were uploaded earlier via
// /bulk-upload/images with the same sessionId. Filenames get resolved
// to their real URL automatically — no manual URL copy-paste needed.
//
// [{"colorName":"White","images":["shirt-white-1.jpg"],"sizes":[{"size":"M","stock":10}]}]
// -------------------------------------------

const MAX_PRODUCTS_PER_UPLOAD = 500;

// ─── Parse CSV buffer to raw rows ─────────────
const parseCSV = (buffer) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = Readable.from(buffer.toString());
    stream
      .pipe(csv())
      .on("data", (row) => results.push(row))
      .on("end", () => resolve(results))
      .on("error", reject);
  });
};

// -------------------------------------------
// BULK UPLOAD (CSV)
// POST /api/admin/products/bulk-upload
// Body: multipart — file: CSV, sessionId?: string (from prior image uploads)
// -------------------------------------------
export const bulkUploadProducts = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "CSV or Excel file is required" });
    }

    const isExcel = /\.(xlsx|xls)$/i.test(req.file.originalname);
    const rows = isExcel
      ? parseXLSX(req.file.buffer)
      : await parseCSV(req.file.buffer);

    if (rows.length === 0) {
      return res.status(400).json({ message: "File is empty" });
    }

    if (rows.length > MAX_PRODUCTS_PER_UPLOAD) {
      return res.status(400).json({ message: `Max ${MAX_PRODUCTS_PER_UPLOAD} products per upload` });
    }

    let products = rows.map(csvRowToProduct);

    const sessionId = req.body.sessionId;
    products = await resolveProductImages(products, sessionId);

    const groupId = await queueBulkUpload(products, req.user);

    return res.status(202).json({
      message: "Upload queued for processing",
      jobId: groupId,
      total: products.length,
    });
  } catch (err) {
    logger.error(`Bulk upload error: ${err.message}`);
    next(err);
  }
};

// -------------------------------------------
// BULK UPLOAD (DIRECT JSON)
// POST /api/admin/products/bulk-upload/json
// Body: { products: [...], sessionId?: string }
// -------------------------------------------
export const bulkUploadProductsJSON = async (req, res, next) => {
  try {
    const { products: rawProducts, sessionId } = req.body;

    if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
      return res.status(400).json({ message: "products array is required" });
    }

    if (rawProducts.length > MAX_PRODUCTS_PER_UPLOAD) {
      return res.status(400).json({ message: `Max ${MAX_PRODUCTS_PER_UPLOAD} products per upload` });
    }

    const products = await resolveProductImages(rawProducts, sessionId);

    const groupId = await queueBulkUpload(products, req.user);

    return res.status(202).json({
      message: "Upload queued for processing",
      jobId: groupId,
      total: products.length,
    });
  } catch (err) {
    logger.error(`Bulk JSON upload error: ${err.message}`);
    next(err);
  }
};

// -------------------------------------------
// GET JOB STATUS
// GET /api/admin/products/bulk-upload/status/:jobId
// -------------------------------------------
export const getBulkUploadStatus = async (req, res, next) => {
  try {
    const status = await getBulkUploadGroupStatus(req.params.jobId);
    if (!status) {
      return res.status(404).json({ message: "Job not found" });
    }

    return res.status(200).json({
      state: status.state,
      progress: status.progress,
      result: status.state === "completed" ? { summary: status.summary, results: status.results } : null,
      error: null,
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------
// DOWNLOAD CSV TEMPLATE
// GET /api/admin/products/bulk-upload/template
// -------------------------------------------
export const downloadTemplate = async (req, res) => {
  const headers = [
    "name",
    "price",
    "subcategorySlug",
    "description",
    "details",
    "offer",
    "offerStart",
    "offerEnd",
    "newArrival",
    "video",
    "colors",
  ].join(",");

  // Example uses filenames, not URLs — matching the new "upload once,
  // reference by filename" workflow.
  const exampleColors = JSON.stringify([
    {
      colorName: "White",
      images: ["linen-shirt-white-1.jpg", "linen-shirt-white-2.jpg"],
      sizes: [
        { size: "S", stock: 10 },
        { size: "M", stock: 20 },
        { size: "L", stock: 15 },
      ],
    },
  ]).replace(/"/g, '""');

  const exampleRow = [
    "Linen Shirt",
    "899",
    "shirts",
    "Premium quality linen shirt",
    "100% linen fabric. Machine washable.",
    "10",
    "",
    "",
    "false",
    "",
    `"${exampleColors}"`,
  ].join(",");

  const csvContent = `${headers}\n${exampleRow}`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=products-template.csv");
  return res.send(csvContent);
};

// -------------------------------------------
// BULK IMAGE UPLOAD (returns Cloudinary URLs + a sessionId)
// POST /api/admin/products/bulk-upload/images
// Body: multipart — images: file[] (field name "images"), sessionId?: string
//
// If sessionId is omitted, a new one is generated and returned — the
// frontend should reuse it for subsequent image-upload calls (so multiple
// batches accumulate into one filename→URL map) and pass it along with
// the final CSV/JSON submission so filenames resolve correctly.
// -------------------------------------------
export const bulkUploadImages = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "At least one image is required" });
    }

    const sessionId = req.body.sessionId || crypto.randomUUID();

    const uploaded = req.files.map((file) => ({
      originalname: file.originalname,
      url: file.path,
      publicId: file.filename,
    }));

    await saveImageSessionMappings(sessionId, uploaded);

    logger.info(`Bulk image upload: ${uploaded.length} images uploaded (session ${sessionId})`);

    return res.status(200).json({
      message: `${uploaded.length} images uploaded successfully`,
      sessionId,
      images: uploaded,
    });
  } catch (err) {
    logger.error(`Bulk image upload error: ${err.message}`);
    next(err);
  }
};


export const getSessionImages = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const map = await getImageSessionMappings(sessionId);
    const images = Object.entries(map).map(([originalname, url]) => ({ originalname, url }));
    return res.status(200).json({ sessionId, images });
  } catch (err) {
    next(err);
  }
};