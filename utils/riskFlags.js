import { notifyAdmin } from "./notifyAdmin.js";

const THRESHOLDS = {
    otp: 5,
    reset: 5,
    returnRate: 0.4,
};

export const checkOtpRisk = async (user) => {
    if (user.otpRequestCount > THRESHOLDS.otp) {
        await notifyAdmin({
            type: "SUSPICIOUS_CUSTOMER",
            severity: "high",
            title: "Suspicious OTP activity detected",
            message: `${user.name} (${user.email}) has requested ${user.otpRequestCount} OTPs — possible abuse.`,
            link: `/customers/${user._id}`,
            data: { customerId: user._id, otpRequestCount: user.otpRequestCount },
            dedupeKey: `suspicious:otp:${user._id}`,
        });
    }
};

export const checkResetRisk = async (user) => {
    if (user.resetRequestCount > THRESHOLDS.reset) {
        await notifyAdmin({
            type: "SUSPICIOUS_CUSTOMER",
            severity: "high",
            title: "Suspicious password reset activity",
            message: `${user.name} (${user.email}) has requested ${user.resetRequestCount} password resets — possible account takeover attempt.`,
            link: `/customers/${user._id}`,
            data: { customerId: user._id, resetRequestCount: user.resetRequestCount },
            dedupeKey: `suspicious:reset:${user._id}`,
        });
    }
};

export const checkReturnRateRisk = async (user, returnRate, totalOrders) => {
    if (totalOrders >= 3 && returnRate > THRESHOLDS.returnRate) {
        await notifyAdmin({
            type: "SUSPICIOUS_CUSTOMER",
            severity: "high",
            title: "High return rate detected",
            message: `${user.name} (${user.email}) has a ${(returnRate * 100).toFixed(0)}% return rate across ${totalOrders} orders.`,
            link: `/customers/${user._id}`,
            data: { customerId: user._id, returnRate: returnRate.toFixed(2), totalOrders },
            dedupeKey: `suspicious:returns:${user._id}`,
        });
    }
};