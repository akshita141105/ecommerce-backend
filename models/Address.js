import mongoose from 'mongoose';

export const addressSchema = new mongoose.Schema({
    fullName: {
        required: true,
        type: String
    },
    phone: {
        type: String,
        required: true
    },
    pincode: {
        type: String,
        required: true
    },
    state: {
        type: String,
        required: true
    },
    city: {
        type: String,
        required: true
    },
    addressData: {
        required: true,
        type: String
    },
    landmark: {
        type: String
    },
    isDefault: {
        type: Boolean,
        default: false
    }},
    {timestamps:true});
