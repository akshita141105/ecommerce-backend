import dotenv from "dotenv";
dotenv.config();
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

console.log("Testing SMTP with:", {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    from: process.env.SMTP_FROM_EMAIL,
});

transporter.sendMail({
    from: `"DRAPE" <${process.env.SMTP_FROM_EMAIL}>`,
    to: "advaitpandey1508@gmail.com",
    subject: "Test Email",
    html: "<p>Test email from local script</p>",
})
    .then((info) => console.log("✅ SUCCESS:", info))
    .catch((err) => console.error("❌ FAILED:", err));