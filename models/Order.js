import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
     product: {
    type: mongoose.Schema.Types.ObjectId,
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

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ✅ NEW: cart reference — core idempotency check ke liye
    cart: { type: mongoose.Schema.Types.ObjectId, ref: "Cart", required: true, index: true },

    // ✅ NEW: client-generated key — extra safety layer race conditions ke against
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

    razorpayOrderId:String,
    paymentId:String,

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed","cod","expired"],
      default: "pending",
    },

    // ✅ NEW: guard flag — prevents double stock-release (idempotency)
    stockReleased: { type: Boolean, default: false },

    paymentMethod: {
      type: String,
      enum: ["wallet", "razorpay", "wallet+razorpay", "cod"],
    },
    walletUsed: { type: Number, default: 0 },

    orderStatus: {
      type: String,
      enum: ["placed", "processing", "shipped", "delivered", "cancelled", "returned"], // cancelled bhi add kar diya, jo pehle discuss kiya tha
      default: "placed",
    },

    // Order.js model mein field add karo
    deliveredAt: {
      type: Date,
      default: null
    },

    cancelReason: { type: String, default: null },
    cancelledBy: { type: String, enum: ["admin", "user", "system"], default: null },
    cancelledAt: { type: Date, default: null },
    
    codFee: { type: Number, default: 0 },

    failureReason: { type: String, default: null },   // ★ Razorpay decline reason store karne ke liye


  },
  { timestamps: true }
);

// Schema ke baad, export se pehle yeh add karo
orderSchema.index({ user: 1, createdAt: -1 });      // user ka order history
orderSchema.index({ orderStatus: 1, createdAt: -1 }); // admin panel filter
orderSchema.index({ razorpayOrderId: 1 });            // payment webhook lookup
orderSchema.index({ cart: 1, paymentStatus: 1 });      // payment filter


export default mongoose.model("Order", orderSchema);