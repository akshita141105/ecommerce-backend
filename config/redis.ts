import { createClient } from "redis";
import logger from "../utils/logger.js";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL environment variable is not set");
}

const client = createClient({
  url: redisUrl,
});

client.on("error", (err) => {
  logger.error("Redis Error:", err);
});

await client.connect();

export default client;
