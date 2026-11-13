import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ICategory extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  image: string;
}

const categorySchema = new Schema<ICategory>(
  {
    name: {
      required: true,
      unique: true,
      trim: true,
      type: String,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    image: {
      required: true,
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<ICategory>("Category", categorySchema);
