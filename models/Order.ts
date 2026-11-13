import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IOrderItem {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  name?: string;
  image?: string;
  selectedColor?: string;
  selectedSize?: string;
  quantity?: number;
  price?: number;
}

const orderItemSchema = new Schema<IOrderItem>({
  product: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  name: String,
  image: String,
  selectedColor: String,
  selectedSize: String,
  quantity: Number,
  price: Number,
});

export type PaymentStatus = "pending" | "paid" | "failed" | "cod" | "expired";
// "manual" — set by adminPaymentController's markOrderPaid when an admin
// manually marks a failed/expired order as paid (fallback when the order
// never had a real paymentMethod recorded).
export type PaymentMethod = "wallet" | "razorpay" | "wallet+razorpay" | "cod" | "manual";
export type OrderStatus = "placed" | "processing" | "shipped" | "delivered" | "cancelled" | "returned";
export type CancelledBy = "admin" | "user" | "system";

export interface IOrderAddress {
  fullName?: string;
  phone?: string;
  pincode?: string;
  state?: string;
  city?: string;
  addressData?: string;
  landmark?: string;
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  cart: Types.ObjectId;
  idempotencyKey?: string;
  address: IOrderAddress;
  items: Types.DocumentArray<IOrderItem>;
  subtotal: number;
  shipping: number;
  tax: number;
  totalAmount: number;
  invoiceNumber?: string;
  razorpayOrderId?: string;
  paymentId?: string;
  paymentStatus: PaymentStatus;
  stockReleased: boolean;
  paymentMethod?: PaymentMethod;
  walletUsed: number;
  orderStatus: OrderStatus;
  deliveredAt: Date | null;
  cancelReason: string | null;
  cancelledBy: CancelledBy | null;
  cancelledAt: Date | null;
  codFee: number;
  failureReason: string | null;
  // Audit trail for admin "mark as paid" overrides (controllers/admin/adminPaymentController.ts).
  markedPaidBy: Types.ObjectId | null;
  markedPaidAt: Date | null;
  manualPaymentNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const orderSchema = new Schema<IOrder>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Cart reference — core idempotency check ke liye
    cart: { type: Schema.Types.ObjectId, ref: "Cart", required: true, index: true },

    // Client-generated key — extra safety layer race conditions ke against
    idempotencyKey: { type: String, unique: true, sparse: true },

    address: {
      fullName: String,
      phone: String,
      pincode: String,
      state: String,
      city: String,
      addressData: String,
      landmark: String,
    },

    items: [orderItemSchema],

    subtotal: { type: Number, required: true },
    shipping: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },

    invoiceNumber: String,

    razorpayOrderId: String,
    paymentId: String,

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "cod", "expired"],
      default: "pending",
    },

    // Guard flag — prevents double stock-release (idempotency)
    stockReleased: { type: Boolean, default: false },

    paymentMethod: {
      type: String,
      enum: ["wallet", "razorpay", "wallet+razorpay", "cod", "manual"],
    },
    walletUsed: { type: Number, default: 0 },

    orderStatus: {
      type: String,
      enum: ["placed", "processing", "shipped", "delivered", "cancelled", "returned"],
      default: "placed",
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    cancelReason: { type: String, default: null },
    cancelledBy: { type: String, enum: ["admin", "user", "system"], default: null },
    cancelledAt: { type: Date, default: null },

    codFee: { type: Number, default: 0 },

    failureReason: { type: String, default: null }, // Razorpay decline reason store karne ke liye

    markedPaidBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    markedPaidAt: { type: Date, default: null },
    manualPaymentNote: { type: String, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 }); // user ka order history
orderSchema.index({ orderStatus: 1, createdAt: -1 }); // admin panel filter
orderSchema.index({ razorpayOrderId: 1 }); // payment webhook lookup
orderSchema.index({ cart: 1, paymentStatus: 1 }); // payment filter

export default mongoose.model<IOrder>("Order", orderSchema);
