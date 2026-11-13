import type { NextFunction, Request, Response } from "express";
import Order from "../../models/Order.js";

export const getMyOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orders = await Order.find({
      user: req.user!._id,
      paymentStatus: { $in: ["paid", "cod"] }, // sirf successful orders
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    next(err);
  }
};

export const getSingleOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user!._id, // ✅ security check
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    return res.status(200).json({ success: true, order });
  } catch (err) {
    next(err);
  }
};
