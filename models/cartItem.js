// models/cartItem.js
import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
  {
    cart: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cart",
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
      default: 1,
    },
    selectedColor: {
      type: String,
      required: true,
      trim: true,
    },
    selectedSize: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
  },
  { timestamps: true }
);

cartItemSchema.index({ cart: 1 });
cartItemSchema.index({ cart: 1, product: 1, selectedColor: 1, selectedSize: 1 });

export default mongoose.model("CartItem", cartItemSchema);
