// models/Lookbook.js
import mongoose from "mongoose";

const lookbookSectionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  products: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
  ],
  order: {
    type: Number,
    default: 0,
  },
});

const lookbookSchema = new mongoose.Schema(
  {
    sections: [lookbookSectionSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Lookbook", lookbookSchema);