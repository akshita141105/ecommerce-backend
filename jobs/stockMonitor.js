// jobs/stockMonitor.js
import cron from "node-cron";
import Product from "../models/Product.js";
import { notifyAdmin } from "../utils/notifyAdmin.js";
import logger from "../utils/logger.js";

const LOW_STOCK_THRESHOLD = 5;

export const checkStockLevels = async () => {
    try {
        const products = await Product.find({}).lean();

        let outCount = 0;
        let lowCount = 0;

        for (const product of products) {
            for (const colorObj of product.colors ?? []) {
                for (const sizeObj of colorObj.sizes ?? []) {
                    const available = sizeObj.available ?? Math.max(0, sizeObj.stock - (sizeObj.reserved ?? 0));

                    if (available === 0) {
                        outCount++;
                        await notifyAdmin({
                            type: "OUT_OF_STOCK",
                            severity: "high",
                            title: `${product.name} (${colorObj.colorName}/${sizeObj.size}) out of stock`,
                            message: `0 units available. Restock needed.`,
                            link: `/inventory?search=${encodeURIComponent(product.name)}`,
                            data: { productId: product._id, color: colorObj.colorName, size: sizeObj.size },
                            dedupeKey: `out-of-stock:${product._id}:${colorObj.colorName}:${sizeObj.size}`,
                        });
                    } else if (available <= LOW_STOCK_THRESHOLD) {
                        lowCount++;
                        await notifyAdmin({
                            type: "LOW_STOCK",
                            severity: "medium",
                            title: `${product.name} (${colorObj.colorName}/${sizeObj.size}) running low`,
                            message: `Only ${available} unit(s) left.`,
                            link: `/inventory?search=${encodeURIComponent(product.name)}`,
                            data: { productId: product._id, color: colorObj.colorName, size: sizeObj.size, available },
                            dedupeKey: `low-stock:${product._id}:${colorObj.colorName}:${sizeObj.size}`,
                        });
                    }
                }
            }
        }

        logger.info(`Stock monitor run complete | out-of-stock: ${outCount} | low-stock: ${lowCount}`);
    } catch (err) {
        logger.error("checkStockLevels cron failed:", err);
    }
};

export const registerStockMonitorCron = () => {
    cron.schedule("0 * * * *", checkStockLevels); // har ghante
    logger.info("Cron job registered: checkStockLevels (every hour)");
};