// models/WishlistItem.js
import mongoose from 'mongoose';

const wishlistItemSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    color: {
        type: String,
        required: true
    },
    addedAt: {
        type: Date,
        default: Date.now
    }
});

// Same user same product+color dobara add na ho paaye
wishlistItemSchema.index({ userId: 1, productId: 1, color: 1 }, { unique: true });

export default mongoose.model('WishlistItem', wishlistItemSchema);