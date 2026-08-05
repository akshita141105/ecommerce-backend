import User from "../../models/User.js";
import logger from "../../utils/logger.js"

/* ================= CREATE ADDRESS ================= */
export const createAddress = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    const { fullName, phone, pincode, state, city, addressData, landmark, isDefault } = req.body;

    if (!fullName || !phone || !pincode || !state || !city || !addressData) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found!" });

    let defaultStatus = isDefault || false;

    // First address automatically default
    if (user.addresses.length === 0) defaultStatus = true;

    // If new address is default → remove default from others
    if (defaultStatus) {
      user.addresses.forEach(addr => (addr.isDefault = false));
    }

    user.addresses.push({
      fullName,
      phone,
      pincode,
      state,
      city,
      addressData,
      landmark,
      isDefault: defaultStatus
    });

    await user.save();
    logger.info(`Address created for user: ${userId}`);

    return res.status(200).json({
      message: "Address created!",
      addresses: user.addresses
    });

  } catch (err) {
    next(err);
  }
};


/* ================= GET ALL ================= */
export const getallAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("addresses");
    if (!user) return res.status(404).json({ message: "User not found!" });

    const sorted = user.addresses.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return res.status(200).json({ addresses: sorted });

  } catch (err) {
    next(err);
  }
};


/* ================= GET SINGLE ================= */
export const getsingleAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("addresses");
    if (!user) return res.status(404).json({ message: "User not found!" });

    const address = user.addresses.id(req.params.addressId);
    if (!address) return res.status(404).json({ message: "Address not found!" });

    return res.status(200).json({ address });

  } catch (err) {
    next(err);
  }
};


/* ================= UPDATE ================= */
export const updateAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    const updates = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found!" });

    const address = user.addresses.id(addressId);
    if (!address) return res.status(404).json({ message: "Address not found!" });

    // If making this address default → remove default from others
    if (updates.isDefault) {
      user.addresses.forEach(addr => (addr.isDefault = false));
    }

    Object.assign(address, updates);

    await user.save();  // 🔥 THIS WAS MISSING IN YOUR CODE
    logger.info(`Address updated: ${addressId} by user: ${req.user._id}`);

    return res.status(200).json({
      message: "Address updated!",
      addresses: user.addresses   // ✅ consistent response
    });

  } catch (err) {
    next(err);
  }
};


/* ================= DELETE ================= */
export const deleteAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found!" });

    const address = user.addresses.id(addressId);
    if (!address) return res.status(404).json({ message: "Address not found!" });

    const wasDefault = address.isDefault;

    address.deleteOne();  // cleaner than filter

    // If default deleted → make first remaining default
    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();
    logger.info(`Address deleted: ${addressId} by user: ${req.user._id}`);

    return res.status(200).json({
      message: "Address deleted!",
      addresses: user.addresses
    });

  } catch (err) {
    next(err);
  }
};