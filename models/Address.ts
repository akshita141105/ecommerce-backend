import { Schema, type Types } from "mongoose";

// Reusable sub-schema embedded in User.addresses[] — not a standalone
// top-level collection/model.
export interface IAddress {
  _id: Types.ObjectId;
  fullName: string;
  phone: string;
  pincode: string;
  state: string;
  city: string;
  addressData: string;
  landmark?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const addressSchema = new Schema<IAddress>(
  {
    fullName: { required: true, type: String },
    phone: { type: String, required: true },
    pincode: { type: String, required: true },
    state: { type: String, required: true },
    city: { type: String, required: true },
    addressData: { required: true, type: String },
    landmark: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);
