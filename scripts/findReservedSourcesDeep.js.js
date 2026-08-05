// scripts/findReservedSourcesDeep.js
//
// DEEPER DIAGNOSTIC — the first script (findReservedSources.js) only
// checked "pending, not-yet-released" Orders and "active" Carts.
// This one casts a wider net: EVERY Order and EVERY Cart that
// references the given variant, regardless of status — so we can
// see exactly which document is holding an orphaned reservation
// and why it was never released.
//
// USAGE:
//   node scripts/findReservedSourcesDeep.js --product=<id> --color=<name> --size=<size>

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import connectmongodb from "../db.js";
import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/cartItem.js";

const arg = (name) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const productId = arg("product");
const color = arg("color");
const size = arg("size");

if (!productId || !color || !size) {
    console.error("Usage: node scripts/findReservedSourcesDeep.js --product=<id> --color=<name> --size=<size>");
    process.exit(1);
}

const run = async () => {
    await connectmongodb();

    console.log(`\nSearching ALL orders/carts referencing product=${productId} color=${color} size=${size}\n`);

    // ── ALL orders, any paymentStatus / orderStatus ──
    const allOrders = await Order.find({
        items: {
            $elemMatch: { product: productId, selectedColor: color, selectedSize: size },
        },
    }).lean();

    console.log(`── Orders referencing this variant: ${allOrders.length} ──`);
    allOrders.forEach((o) => {
        const item = o.items.find(
            (i) => i.product.toString() === productId && i.selectedColor === color && i.selectedSize === size
        );
        console.log(
            `  ${o._id} | qty: ${item?.quantity} | paymentStatus: ${o.paymentStatus} | ` +
            `orderStatus: ${o.orderStatus} | stockReleased: ${o.stockReleased ?? "undefined"} | ` +
            `created: ${o.createdAt.toISOString()}`
        );
    });

    // ── ALL cart items for this variant, plus their cart's status ──
    const allCartItems = await CartItem.find({
        product: productId,
        selectedColor: color,
        selectedSize: size,
    }).lean();

    console.log(`\n── CartItems referencing this variant: ${allCartItems.length} ──`);
    for (const ci of allCartItems) {
        const cart = await Cart.findById(ci.cart).lean();
        console.log(
            `  cartItem ${ci._id} | qty: ${ci.quantity} | cart: ${ci.cart} | ` +
            `cart status: ${cart?.status ?? "CART NOT FOUND (orphaned cartItem!)"} | ` +
            `cart expiresAt: ${cart?.expiresAt?.toISOString?.() ?? "—"}`
        );
    }

    await mongoose.connection.close();
};

run().catch((err) => {
    console.error("findReservedSourcesDeep failed:", err);
    process.exit(1);
});