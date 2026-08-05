// controllers/admin/adminfaqController.js
// Path assumption: controllers/admin/adminfaqController.js -> models/Faq.js is ../../models/Faq.js
//
// Bulk upload accepts CSV (headers: question,answer,topic) or Excel (.xlsx/.xls)
// with the same headers in row 1.
// (install "csv-parse" and "xlsx" — `npm install csv-parse xlsx`)
// Actual queueing/processing lives in services/faqBulkUpload.js (BullMQ + Redis).

import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import Faq from "../../models/Faq.js";
import logger from "../../utils/logger.js";
import { queueFaqBulkUpload, getFaqBulkUploadGroupStatus, csvRowToFaq } from "../../services/faqBulkUpload.js";

const MAX_BULK_ROWS = 5000; // guard against pathological uploads
const CSV_EXTENSIONS = [".csv"];
const EXCEL_EXTENSIONS = [".xlsx", ".xls"];

// Same normalization used by the bulk-upload duplicate check
// (services/faqBulkUpload.js) — kept in sync here so FAQs created or edited
// one-at-a-time through this controller are just as duplicate-detectable as
// ones created via bulk upload.
const normalizeQuestion = (question) => question.trim().toLowerCase();

// ---------- CRUD ----------

// GET /api/admin/faqs?search=&topic=&page=&limit=
export const getAllFaqsAdmin = async (req, res, next) => {
    try {
        const { search = "", topic = "", page = 1, limit = 20 } = req.query;
        const filter = {};

        if (search) {
            const safeSearch = search.trim().slice(0, 200);
            filter.$or = [
                { question: { $regex: safeSearch, $options: "i" } },
                { answer: { $regex: safeSearch, $options: "i" } },
                { topic: { $regex: safeSearch, $options: "i" } },
            ];
        }
        if (topic) {
            filter.topic = {
                $regex: topic.trim(),
                $options: "i"
            };
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

        const [faqs, total] = await Promise.all([
            Faq.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            Faq.countDocuments(filter),
        ]);

        res.json({ faqs, total, page: pageNum, pages: Math.ceil(total / limitNum) });
    } catch (err) {
        logger.error(`Admin FAQ list failed: ${err.message}`);
        next(err);
    }
};

// POST /api/admin/faqs
export const createFaq = async (req, res, next) => {
    try {
        const { question, answer, topic } = req.body;
        if (!question?.trim() || !answer?.trim()) {
            return res.status(400).json({ message: "question and answer are required" });
        }

        const trimmedQuestion = question.trim();
        const questionNormalized = normalizeQuestion(trimmedQuestion);

        const existing = await Faq.findOne({ questionNormalized });
        if (existing) {
            return res.status(409).json({ message: "A FAQ with this question already exists" });
        }

        const faq = await Faq.create({
            question: trimmedQuestion,
            answer: answer.trim(),
            topic: topic?.trim() || "General",
            questionNormalized,
        });
        res.status(201).json(faq);
    } catch (err) {
        logger.error(`Create FAQ failed: ${err.message}`);
        next(err);
    }
};

// PUT /api/admin/faqs/:id
export const updateFaq = async (req, res, next) => {
    try {
        const { question, answer, topic } = req.body;
        const update = {};
        if (question !== undefined) {
            const trimmedQuestion = question.trim();
            update.question = trimmedQuestion;
            update.questionNormalized = normalizeQuestion(trimmedQuestion);
        }
        if (answer !== undefined) update.answer = answer.trim();
        if (topic !== undefined) update.topic = topic.trim() || "General";

        const faq = await Faq.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
        if (!faq) return res.status(404).json({ message: "FAQ not found" });
        res.json(faq);
    } catch (err) {
        logger.error(`Update FAQ failed: ${err.message}`);
        next(err);
    }
};

// DELETE /api/admin/faqs/:id
export const deleteFaq = async (req, res, next) => {
    try {
        const faq = await Faq.findByIdAndDelete(req.params.id);
        if (!faq) return res.status(404).json({ message: "FAQ not found" });
        res.json({ message: "FAQ deleted" });
    } catch (err) {
        logger.error(`Delete FAQ failed: ${err.message}`);
        next(err);
    }
};

// ---------- Bulk upload ----------

// Parse a CSV file (utf-8 text, comma-delimited) into raw row objects keyed by header.
const parseCsvFile = async (filePath) => {
    const raw = await fs.readFile(filePath, "utf-8");
    return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
};

// Parse the first sheet of an Excel workbook (.xlsx/.xls) into raw row objects
// keyed by the first-row headers. `defval: ""` keeps missing cells as empty
// strings instead of being omitted, so csvRowToFaq's shape stays consistent
// with what the CSV path produces.
const parseExcelFile = async (filePath) => {
    const buffer = await fs.readFile(filePath);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
};

// POST /api/admin/faqs/bulk-upload  (multipart, field "file")
// Accepts CSV or Excel. Parses synchronously (fast, cheap) then hands the
// structured rows off to the BullMQ queue for validation + insertion.
// Responds immediately with a groupId; client polls the status endpoint
// below for progress.
export const bulkUploadFaqs = async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ message: "No file uploaded. Attach a CSV or Excel file under field 'file'." });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname || "").toLowerCase();

    try {
        let rawRows;

        if (CSV_EXTENSIONS.includes(ext)) {
            rawRows = await parseCsvFile(filePath);
        } else if (EXCEL_EXTENSIONS.includes(ext)) {
            rawRows = await parseExcelFile(filePath);
        } else {
            return res.status(400).json({
                message: `Unsupported file type "${ext || "unknown"}". Upload a .csv, .xlsx, or .xls file.`,
            });
        }

        if (rawRows.length === 0) {
            return res.status(400).json({ message: "File has no data rows." });
        }
        if (rawRows.length > MAX_BULK_ROWS) {
            return res.status(400).json({ message: `File exceeds max of ${MAX_BULK_ROWS} rows per upload.` });
        }

        const faqRows = rawRows.map(csvRowToFaq);
        const groupId = await queueFaqBulkUpload(faqRows, req.user);

        res.status(202).json({ groupId, totalRows: faqRows.length });
    } catch (err) {
        logger.error(`Bulk upload failed to queue: ${err.message}`);
        return res.status(400).json({
            message: "Could not parse the uploaded file. Check that it's a valid CSV/Excel file with question, answer, topic headers.",
        });
    } finally {
        await fs.unlink(filePath).catch(() => { });
    }
};

// GET /api/admin/faqs/bulk-upload/:groupId/status
// Response shape: { state: "processing"|"completed", progress, summary, results }
export const getFaqBulkUploadStatus = async (req, res, next) => {
    try {
        const status = await getFaqBulkUploadGroupStatus(req.params.groupId);
        if (!status) return res.status(404).json({ message: "Upload job not found or has expired" });
        res.json(status);
    } catch (err) {
        logger.error(`Bulk upload status check failed: ${err.message}`);
        next(err);
    }
};