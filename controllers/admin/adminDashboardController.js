// controllers/admin/adminDashboardController.js
import Order from "../../models/Order.js";
import Product from "../../models/Product.js";
import User from "../../models/User.js";
import client from "../../lib/redis.js";
import logger from "../../utils/logger.js";

// ─── Helper: date range ───────────────────────
// ─── Helper: date range ───────────────────────
const getDateRange = (period, date) => {
  // ★ NAYA — specific single date select ki gayi ho
  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const now = new Date();
  const start = new Date();

  switch (period) {
    case "today": start.setHours(0, 0, 0, 0); break;
    case "week": start.setDate(now.getDate() - 7); break;
    case "month": start.setMonth(now.getMonth() - 1); break;
    case "year": start.setFullYear(now.getFullYear() - 1); break;
    default: start.setMonth(now.getMonth() - 1);
  }

  return { start, end: now };
};

// ─────────────────────────────────────────────
// DASHBOARD STATS
// GET /api/admin/dashboard/stats?period=today|week|month|year
// ─────────────────────────────────────────────
export const getDashboardStats = async (req, res, next) => {
  try {
    const { period = "month", date } = req.query;   // ★ date add kiya
    const CACHE_KEY = date
      ? `admin:dashboard:stats:date:${date}`          // ★ alag cache key specific date ke liye
      : `admin:dashboard:stats:${period}`;

    const cached = await client.get(CACHE_KEY);
    if (cached) {
      logger.info(`Dashboard stats cache hit: ${date || period}`);
      return res.status(200).json({ fromCache: true, ...JSON.parse(cached) });
    }

    const { start, end } = getDateRange(period, date);   // ★ date pass kiya
    const diff = end - start;
    const prevStart = new Date(start.getTime() - diff);
    const prevEnd = new Date(start);

    const [currentOrders, prevOrders, totalProducts, totalCustomers] =
      await Promise.all([
        Order.find({
          createdAt: { $gte: start, $lte: end },
          paymentStatus: { $in: ["paid", "cod"] },
        }).lean(),

        Order.find({
          createdAt: { $gte: prevStart, $lte: prevEnd },
          paymentStatus: { $in: ["paid", "cod"] },
        }).lean(),

        Product.countDocuments(),

        User.countDocuments({ role: "user", isVerified: true }),
      ]);

    const totalRevenue = currentOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const prevRevenue = prevOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const totalOrders = currentOrders.length;
    const prevOrdersCount = prevOrders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const revenueChange = prevRevenue > 0
      ? Number((((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1))
      : 0;
    const ordersChange = prevOrdersCount > 0
      ? Number((((totalOrders - prevOrdersCount) / prevOrdersCount) * 100).toFixed(1))
      : 0;

    const data = {
      totalRevenue,
      totalOrders,
      totalProducts,
      totalCustomers,
      avgOrderValue: Math.round(avgOrderValue),
      revenueChange,
      ordersChange,
    };

    await client.setEx(CACHE_KEY, 120, JSON.stringify(data));

    return res.status(200).json({ fromCache: false, ...data });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REVENUE CHART
// GET /api/admin/dashboard/revenue-chart?period=week|month
// ─────────────────────────────────────────────
export const getRevenueChart = async (req, res, next) => {
  try {
    const { period = "week", date } = req.query;   // ★ date add kiya
    const CACHE_KEY = date
      ? `admin:dashboard:chart:date:${date}`
      : `admin:dashboard:chart:${period}`;

    const cached = await client.get(CACHE_KEY);
    if (cached) {
      logger.info(`Revenue chart cache hit: ${date || period}`);
      return res.status(200).json({ fromCache: true, data: JSON.parse(cached) });
    }

    let start, days;

    if (date) {
      // ★ NAYA — selected date se 6 din pehle tak (us din ko end mein rakhte hue), total 7 din ka context
      days = 7;
      start = new Date(date);
      start.setDate(start.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);
    } else {
      days = period === "week" ? 7 : 30;
      start = new Date();
      start.setDate(start.getDate() - days);
      start.setHours(0, 0, 0, 0);
    }

    const chartData = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: start },
          paymentStatus: { $in: ["paid", "cod"] },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fill missing days with 0
    const result = [];
    const baseDate = date ? new Date(date) : new Date();   // ★ end point date ke hisaab se

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const found = chartData.find((item) => item._id === dateStr);
      result.push({
        date: dateStr,
        day: d.toLocaleDateString("en-IN", { weekday: "short" }),
        revenue: found?.revenue || 0,
        orders: found?.orders || 0,
      });
    }

    await client.setEx(CACHE_KEY, 120, JSON.stringify(result));

    return res.status(200).json({ fromCache: false, data: result });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// RECENT ORDERS
// GET /api/admin/dashboard/recent-orders
// ─────────────────────────────────────────────
export const getRecentOrders = async (req, res, next) => {
  try {
    const CACHE_KEY = "admin:dashboard:recent-orders";

    const cached = await client.get(CACHE_KEY);
    if (cached) {
      logger.info("Recent orders cache hit");
      return res.status(200).json({ fromCache: true, orders: JSON.parse(cached) });
    }

    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("user", "name email")
      .lean();

    const formatted = orders.map((o) => ({
      _id: o._id,
      invoiceNumber: o.invoiceNumber || `#${o._id.toString().slice(-4).toUpperCase()}`,
      customerName: o.user?.name || o.address?.fullName || "Unknown",
      customerEmail: o.user?.email || "",
      product: o.items?.[0]?.name || "Multiple items",
      itemCount: o.items?.length || 0,
      totalAmount: o.totalAmount,
      orderStatus: o.orderStatus,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    }));

    await client.setEx(CACHE_KEY, 60, JSON.stringify(formatted));

    return res.status(200).json({ fromCache: false, orders: formatted });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// TOP PRODUCTS
// GET /api/admin/dashboard/top-products
// ─────────────────────────────────────────────
export const getTopProducts = async (req, res, next) => {
  try {
    const CACHE_KEY = "admin:dashboard:top-products";

    const cached = await client.get(CACHE_KEY);
    if (cached) {
      logger.info("Top products cache hit");
      return res.status(200).json({ fromCache: true, products: JSON.parse(cached) });
    }

    const topProducts = await Order.aggregate([
      { $match: { paymentStatus: { $in: ["paid", "cod"] } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          totalSold: { $sum: "$items.quantity" },
          totalRevenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          name: { $first: "$items.name" },
          image: { $first: "$items.image" },
        },
      },
      { $sort: { totalSold: -1 } },
      { $limit: 5 },
    ]);

    await client.setEx(CACHE_KEY, 300, JSON.stringify(topProducts));

    return res.status(200).json({ fromCache: false, products: topProducts });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET ALL ORDERS — Admin
// GET /api/admin/orders?page=1&limit=10&status=&paymentStatus=
// ─────────────────────────────────────────────
export const getAdminOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, paymentStatus } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (status) filter.orderStatus = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("user", "name email")
        .lean(),
      Order.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      orders,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// UPDATE ORDER STATUS — Admin
// PATCH /api/admin/orders/:id/status
// Body: { orderStatus }
// ─────────────────────────────────────────────
export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { orderStatus } = req.body;

    const validStatuses = ["placed", "processing", "shipped", "delivered", "cancelled"];
    if (!validStatuses.includes(orderStatus)) {
      return res.status(400).json({ message: "Invalid order status" });
    }

    const order = await Order.findByIdAndUpdate(
      id,
      { orderStatus },
      { new: true }
    ).populate("user", "name email");

    if (!order) return res.status(404).json({ message: "Order not found" });

    await client.del("admin:dashboard:recent-orders");

    const statsKeys = await client.keys("admin:dashboard:stats:*");
    const chartKeys = await client.keys("admin:dashboard:chart:*");
    const allKeys = [...statsKeys, ...chartKeys];
    if (allKeys.length) await client.del(allKeys);

    logger.info(`Order status updated: ${id} → ${orderStatus}`);
    return res.status(200).json({ message: "Order status updated", order });
  } catch (err) {
    next(err);
  }
};