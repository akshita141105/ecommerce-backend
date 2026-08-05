import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
    name:{
        required:true,
        unique:true,
        trim:true,
        type:String
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
},
{
    timestamps:true
});

export default mongoose.model("Category",categorySchema); 