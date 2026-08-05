import mongoose from 'mongoose';

// mongoose.set('debug', true);

const connectmongodb = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Mongodb connected successfully");
    } catch (err) {
        console.log("Mongodb connection failed", err.message);
        process.exit(1);
    }
};

export default connectmongodb;