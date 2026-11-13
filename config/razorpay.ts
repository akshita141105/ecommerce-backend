// config/razorpay.ts
import Razorpay from "razorpay";

let razorpayInstance: Razorpay | null = null;

export const getRazorpay = (): Razorpay => {
  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID as string,
      key_secret: process.env.RAZORPAY_KEY_SECRET as string,
    });
  }
  return razorpayInstance;
};
