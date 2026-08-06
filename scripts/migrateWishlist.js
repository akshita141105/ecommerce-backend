// scripts/migrateWishlist.js
import mongoose from 'mongoose';
import User from '../models/User.js';
import WishlistItem from '../models/WishlistItem.js';

import connectmongodb from "../db.js";
import dotenv from "dotenv";

dotenv.config();

await connectmongodb();

async function migrateWishlist() {

    // ── .lean() zaroori hai: User schema se "wishlist" field hata diya gaya hai,
    // isliye Mongoose hydrated documents mein wo field include hi nahi karta,
    // chahe raw MongoDB document mein data pada ho. .lean() se raw JS object
    // milta hai jisme purana "wishlist" array (agar hai) dikh jayega.
    const users = await User.find({ wishlist: { $exists: true, $ne: [] } }).lean();
    console.log(`${users.length} users ka wishlist migrate karna hai`);

    if (users.length === 0) {
        console.log("No data found for migration.");
        process.exit(0);
    }

    let migrated = 0;
    for (const user of users) {
        if (!Array.isArray(user.wishlist)) continue; // safety guard

        for (const item of user.wishlist) {
            try {
                await WishlistItem.create({
                    userId: user._id,
                    productId: item.productId,
                    color: item.color
                });
                migrated++;
            } catch (err) {
                if (err.code === 11000) continue; // duplicate, skip
                console.error(`Failed for user ${user._id}:`, err.message);
            }
        }
    }

    console.log(`${migrated} wishlist items migrated`);
    process.exit(0);
}

migrateWishlist();