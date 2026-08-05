// flush-wishlist-cache.js
import client from "../lib/redis.js";

const run = async () => {
    const keys = await client.keys("wishlist:*");
    console.log(`Found ${keys.length} wishlist cache key(s)`);

    if (keys.length > 0) {
        await client.del(keys);
        console.log("Deleted:", keys);
    }

    process.exit(0);
};

run().catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
});