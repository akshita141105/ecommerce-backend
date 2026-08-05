// utils/shipping.js
// ─────────────────────────────────────────────
// Shipping calculation logic
// Free above ₹999, ₹49 below
// ─────────────────────────────────────────────

export const FREE_SHIPPING_ABOVE = 999;
export const SHIPPING_CHARGE = 49;

export const calculateShipping = (subtotal) => {
    return subtotal >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_CHARGE;
};

export const calculateCODFee = (subtotal) => {
    const COD_FEE = 30; // apni choice se amount set karo
    return COD_FEE;
};