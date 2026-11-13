// models/LookBook.ts
import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ILookbookSection {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  products: Types.ObjectId[];
  order: number;
}

const lookbookSectionSchema = new Schema<ILookbookSection>({
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
      type: Schema.Types.ObjectId,
      ref: "Product",
    },
  ],
  order: {
    type: Number,
    default: 0,
  },
});

export interface ILookbook extends Document {
  _id: Types.ObjectId;
  sections: Types.DocumentArray<ILookbookSection>;
}

const lookbookSchema = new Schema<ILookbook>(
  {
    sections: [lookbookSectionSchema],
  },
  { timestamps: true }
);

export default mongoose.model<ILookbook>("Lookbook", lookbookSchema);
