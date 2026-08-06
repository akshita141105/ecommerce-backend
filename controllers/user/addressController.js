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

    const existing = await User.findById(userId).select("addresses").lean();
    if (!existing) return res.status(404).json({ message: "User not found!" });

    let defaultStatus = isDefault || false;
    if (existing.addresses.length === 0) defaultStatus = true;

    // ── Agar naya address default banna hai, pehle sab existing ko false karo ──
    if (defaultStatus) {
      await User.updateOne(
        { _id: userId },
        { $set: { "addresses.$[].isDefault": false } }
      );
    }

    // ── Ab naya address atomically push karo ──
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $push: {
          addresses: { fullName, phone, pincode, state, city, addressData, landmark, isDefault: defaultStatus },
        },
      },
      { new: true }
    );

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

    const existing = await User.findById(req.user._id).select("addresses").lean();
    if (!existing) return res.status(404).json({ message: "User not found!" });

    const addressExists = existing.addresses.some((a) => a._id.toString() === addressId);
    if (!addressExists) return res.status(404).json({ message: "Address not found!" });

    // ── Agar isko default banana hai, pehle sab ko false karo ──
    if (updates.isDefault) {
      await User.updateOne(
        { _id: req.user._id },
        { $set: { "addresses.$[].isDefault": false } }
      );
    }

    // ── Ab specific address ke fields update karo (positional operator se) ──
    const setFields = {};
    Object.keys(updates).forEach((key) => {
      setFields[`addresses.$.${key}`] = updates[key];
    });

    const user = await User.findOneAndUpdate(
      { _id: req.user._id, "addresses._id": addressId },
      { $set: setFields },
      { new: true }
    );
    
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

    const existing = await User.findById(req.user._id).select("addresses").lean();
    if (!existing) return res.status(404).json({ message: "User not found!" });

    const address = existing.addresses.find((a) => a._id.toString() === addressId);
    if (!address) return res.status(404).json({ message: "Address not found!" });

    const wasDefault = address.isDefault;

    // ── Address atomically pull karo ──
    let user = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { addresses: { _id: addressId } } },
      { new: true }
    );

    // ── Agar deleted wala default tha, pehla remaining address default banao ──
    if (wasDefault && user.addresses.length > 0) {
      user = await User.findOneAndUpdate(
        { _id: req.user._id },
        { $set: { "addresses.0.isDefault": true } },
        { new: true }
      );
    }
    
    logger.info(`Address deleted: ${addressId} by user: ${req.user._id}`);

    return res.status(200).json({
      message: "Address deleted!",
      addresses: user.addresses
    });

  } catch (err) {
    next(err);
  }
};