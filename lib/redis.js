import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL;

console.log("REDIS_URL =", redisUrl);

if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is not set");
}

const client = createClient({
    url: redisUrl,
});

client.on("error", (err) => {
    console.error("Redis Error:", err);
});

await client.connect();

export default client;