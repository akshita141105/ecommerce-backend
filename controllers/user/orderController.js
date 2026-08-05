import Order from "../../models/Order.js";
import Cart from "../../models/Cart.js"
import cartItem from "../../models/cartItem.js"
import logger from "../../utils/logger.js";


// export const createOrder = async(req,res) => {
//     try{
//         const userId = req.user._id;
//         const {address} = req.body;

//         //get active cart
//         const cart = await Cart.findOne({user:userId,status:"active"});
//         if(!cart){
//             return res.status(400).json({message:"Cart not found"});
//         }

//         //get cart items
//         const cartItems = await cartItem.find({cart:cart._id}).populate("product");

//         if(cartItems.length === 0){
//             return res.status(400).json({message:"Cart is empty"});
//         }

//         //calculate totals
//         let subtotal = 0;
//         const orderItems = cartItems.map(item => {
            
//         const price = item.product.price;
//         subtotal += price * item.quantity;

//         const colorObj = item.product.colors.find(c => c.colorName === item.selectedColor);


//             return{
//                 product:item.product._id,
//                 name:item.product.name,
//                 image:colorObj?.images[0] || "",
//                 selectedColor:item.selectedColor,
//                 selectedSize:item.selectedSize,
//                 quantity:item.quantity,
//                 price:item.product.price
//             };
//         });

//         const shipping = 0;
//         const tax = 0;
//         const totalAmount = subtotal + shipping + tax;

//         //create order
//         const order = await Order.create({
//             user:userId,
//             address,
//             items:orderItems,
//             subtotal,
//             shipping,
//             tax,
//             totalAmount,
//         });



//         res.status(201).json({
//             message:"Order created successfully",
//             orderId : order._id,
//             totalAmount,
//         });
//     } catch(err){
//         return res.status(500).json({message:err.message});
//     }
// }


export const getMyOrders = async (req, res, next) => {
    try {
        const orders = await Order.find({
            user: req.user._id,
            paymentStatus: { $in: ["paid", "cod"] },   // 👈 sirf successful orders
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

export const getSingleOrder = async (req, res, next) => {
    try {
        const order = await Order.findOne({
            _id: req.params.id,
            user: req.user._id // ✅ security check
        });

        if (!order) return res.status(404).json({ message: "Order not found" });

        return res.status(200).json({ success: true, order });
    } catch (err) {
        next(err);
    }
};