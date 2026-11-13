import mongoose from "mongoose";
import logger from "../utils/logger.js";

mongoose.set("debug", true);

const connectmongodb = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    logger.info("MongoDB connected successfully");
  } catch (err) {
    logger.error("MongoDB connection failed", { error: (err as Error).message });
    process.exit(1);
  }
};

export default connectmongodb;
