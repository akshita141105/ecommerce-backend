import mongoose from 'mongoose';

const sizeChartRowSchema = new mongoose.Schema({
    size: { type: String, required: true },        // "S", "M", "L", "XL"
    sizeNumber: { type: String },                    // "38", "40", "42" — optional numeric size
    chest: Number,
    frontLength: Number,
    acrossShoulder: Number,
    waist: Number,
    sleeveLength: Number,                            // optional — shirts ke liye
}, { _id: false });

const subcategorySchema = new mongoose.Schema({
    name:{
        required:true,
        unique:true,
        trim:true,
        type:String
    },
    category:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Category",
        required:true
    },
    slug:{
        type:String,
        required:true,
        unique:true
    },
    image:{
        required:true,
        type:String
    },
    sizeChart: {                              // ← NAYA
        unit: { type: String, enum: ["in", "cm"], default: "in" },
        rows: [sizeChartRowSchema],
    },
},
{
    timestamps:true
});

subcategorySchema.index({ category: 1 }); // category se subcategories fetch ke liye


export default mongoose.model("Subcategory",subcategorySchema); 