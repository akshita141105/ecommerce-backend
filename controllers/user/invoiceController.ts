import type { NextFunction, Request, Response } from "express";
import puppeteer, { type Browser } from "puppeteer";
import Order from "../../models/Order.js";
import logger from "../../utils/logger.js";
import { generateInvoiceHTML } from "../../utils/invoiceTemplate.js";

// ─────────────────────────────────────────────
// 🧾 GENERATE INVOICE PDF
// GET /api/order/:orderId/invoice
// ─────────────────────────────────────────────
export const generateInvoice = async (req: Request, res: Response, next: NextFunction) => {
  let browser: Browser | null = null;
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      user: req.user!._id, // ✅ Security check
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // ✅ Sirf paid ya delivered order
    const canDownload = order.paymentStatus === "paid" || order.orderStatus === "delivered";

    if (!canDownload) {
      return res.status(400).json({
        message: "Invoice available only after payment or delivery",
      });
    }

    const invoiceNo = `INV-${String(order._id).slice(-8).toUpperCase()}`;

    // ── HTML generate karo ──
    const html = generateInvoiceHTML(order, invoiceNo);

    // ── Puppeteer se PDF banao ──
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    await browser.close();
    browser = null;

    // ── Response ──
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoiceNo}.pdf"`);

    res.send(pdfBuffer);

    logger.info(`Invoice generated: ${invoiceNo} | User: ${req.user!._id}`);
  } catch (err) {
    if (browser) await (browser as Browser).close();
    next(err);
  }
};
