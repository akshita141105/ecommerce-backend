const STORE = {
    name:    process.env.STORE_NAME    || "MyStore",
    email:   process.env.STORE_EMAIL   || "support@mystore.com",
    phone:   process.env.STORE_PHONE   || "+91 98765 43210",
    address: process.env.STORE_ADDRESS || "123, MG Road, Mumbai, Maharashtra - 400001",
    gstin:   process.env.STORE_GSTIN   || "Not Registered",
    website: process.env.STORE_WEBSITE || "www.mystore.com",
};

const fmtPrice = (n) =>
    `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const fmtDate = (d) =>
    new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
    });

// ─────────────────────────────────────────────
// 🧾 GENERATE INVOICE HTML
// ─────────────────────────────────────────────
export const generateInvoiceHTML = (order, invoiceNo) => {
    const invoiceDate = fmtDate(order.createdAt);
    const orderIdDisp = `#${String(order._id).slice(-8).toUpperCase()}`;
    const isCOD       = order.paymentStatus === "cod";
    const items       = order.items || [];
    const totalQty    = items.reduce((s, i) => s + i.quantity, 0);

    // ── Items rows HTML ──
    const itemsHTML = items.map((item, idx) => `
        <tr class="${idx % 2 === 0 ? "row-even" : "row-odd"}">
            <td class="td-center">${idx + 1}</td>
            <td>
                <div class="item-cell">
                    ${item.image
                        ? `<img src="${item.image}" class="item-img" alt="${item.name}" />`
                        : `<div class="item-img-placeholder">🛍️</div>`
                    }
                    <div class="item-details">
                        <div class="item-name">${item.name || ""}</div>
                        <div class="item-variant">
                            ${item.selectedSize  ? `Size: ${item.selectedSize}` : ""}
                            ${item.selectedColor ? ` &bull; ${item.selectedColor}` : ""}
                        </div>
                    </div>
                </div>
            </td>
            <td class="td-center">${item.quantity}</td>
            <td class="td-right">${fmtPrice(item.price)}</td>
            <td class="td-center tax-incl">Incl.</td>
            <td class="td-right amount-col">${fmtPrice(item.price * item.quantity)}</td>
        </tr>
    `).join("");

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Invoice - ${invoiceNo}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
            font-size: 12px;
            color: #1a1a1a;
            background: #fff;
        }

        .page {
            width: 794px;
            min-height: 1123px;
            margin: 0 auto;
            background: #fff;
            border: 1px solid #d1d5db;
            position: relative;
        }

        /* ── HEADER ── */
        .header {
            background: #1e3a8a;
            padding: 20px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .store-name {
            font-size: 26px;
            font-weight: 800;
            color: #fff;
            letter-spacing: -0.5px;
        }

        .store-website {
            font-size: 10px;
            color: #93c5fd;
            margin-top: 4px;
        }

        .header-right {
            text-align: right;
        }

        .invoice-title {
            font-size: 22px;
            font-weight: 800;
            color: #fff;
            letter-spacing: 2px;
        }

        .invoice-subtitle {
            font-size: 9px;
            color: #93c5fd;
            margin-top: 4px;
        }

        /* ── BLUE STRIP ── */
        .accent-strip {
            height: 4px;
            background: linear-gradient(90deg, #3b82f6, #60a5fa);
        }

        /* ── DETAILS ROW ── */
        .details-row {
            display: flex;
            background: #eff6ff;
            border-bottom: 1px solid #bfdbfe;
        }

        .detail-cell {
            flex: 1;
            padding: 10px 14px;
            border-right: 1px solid #bfdbfe;
        }

        .detail-cell:last-child { border-right: none; }

        .detail-label {
            font-size: 8px;
            font-weight: 700;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 3px;
        }

        .detail-value {
            font-size: 10px;
            font-weight: 700;
            color: #1e3a8a;
        }

        /* ── ADDRESS SECTION ── */
        .address-section {
            display: flex;
            border-bottom: 1px solid #e5e7eb;
        }

        .address-box {
            flex: 1;
            padding: 12px 16px;
            border-right: 1px solid #e5e7eb;
        }

        .address-box:last-child { border-right: none; }

        .address-header {
            font-size: 8px;
            font-weight: 700;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            background: #f1f5f9;
            padding: 5px 8px;
            margin: -12px -16px 10px -16px;
            border-bottom: 1px solid #e5e7eb;
        }

        .address-name {
            font-size: 11px;
            font-weight: 700;
            color: #111;
            margin-bottom: 4px;
        }

        .address-text {
            font-size: 10px;
            color: #555;
            line-height: 1.6;
        }

        .gstin-text {
            font-size: 9px;
            color: #888;
            margin-top: 6px;
        }

        /* ── ITEMS TABLE ── */
        .items-section { padding: 0; }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        thead tr {
            background: #1e3a8a;
        }

        thead th {
            color: #fff;
            font-size: 9px;
            font-weight: 700;
            padding: 9px 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-right: 1px solid #2d4fa0;
        }

        thead th:last-child { border-right: none; }

        .col-sno    { width: 35px;  text-align: center; }
        .col-item   { width: 280px; text-align: left;   }
        .col-qty    { width: 45px;  text-align: center; }
        .col-price  { width: 90px;  text-align: right;  }
        .col-tax    { width: 50px;  text-align: center; }
        .col-amount { width: 100px; text-align: right;  }

        .row-even { background: #fff;    }
        .row-odd  { background: #f8fafc; }

        td {
            padding: 10px;
            vertical-align: middle;
            border-bottom: 1px solid #e5e7eb;
            border-right: 1px solid #e5e7eb;
            font-size: 11px;
        }

        td:last-child { border-right: none; }

        .td-center { text-align: center; }
        .td-right  { text-align: right;  }

        /* ── Item cell with image ── */
        .item-cell {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .item-img {
            width: 52px;
            height: 52px;
            object-fit: cover;
            border-radius: 6px;
            border: 1px solid #e5e7eb;
            flex-shrink: 0;
        }

        .item-img-placeholder {
            width: 52px;
            height: 52px;
            background: #f1f5f9;
            border-radius: 6px;
            border: 1px solid #e5e7eb;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            flex-shrink: 0;
        }

        .item-details { flex: 1; }

        .item-name {
            font-size: 11px;
            font-weight: 700;
            color: #111;
            margin-bottom: 3px;
        }

        .item-variant {
            font-size: 9.5px;
            color: #888;
        }

        .tax-incl {
            font-size: 9px;
            color: #888;
            font-style: italic;
        }

        .amount-col {
            font-weight: 700;
            color: #111;
        }

        /* ── TOTALS ── */
        .bottom-section {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 16px 20px;
            border-top: 2px solid #e5e7eb;
            gap: 20px;
        }

        .items-summary {
            font-size: 10px;
            color: #888;
            padding-top: 4px;
        }

        .items-summary span {
            font-weight: 700;
            color: #555;
        }

        .totals-box {
            min-width: 240px;
        }

        .total-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 12px;
            border-bottom: 1px solid #e5e7eb;
            font-size: 11px;
        }

        .total-row:last-child { border-bottom: none; }

        .total-label { color: #555; }
        .total-value { font-weight: 600; color: #111; }

        .free-tag {
            color: #16a34a;
            font-weight: 700;
        }

        .grand-total-row {
            background: #1e3a8a;
            border-radius: 6px;
            padding: 10px 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 6px;
        }

        .grand-total-label {
            font-size: 11px;
            font-weight: 700;
            color: #fff;
        }

        .grand-total-value {
            font-size: 14px;
            font-weight: 800;
            color: #fff;
        }

        /* ── PAYMENT NOTE ── */
        .payment-note {
            margin: 0 20px 12px;
            padding: 10px 14px;
            border-radius: 6px;
            border-left: 4px solid;
            font-size: 10px;
            font-weight: 600;
        }

        .payment-note.cod {
            background: #fffbeb;
            border-color: #f59e0b;
            color: #92400e;
        }

        .payment-note.paid {
            background: #f0fdf4;
            border-color: #22c55e;
            color: #15803d;
        }

        /* ── TERMS ── */
        .terms {
            margin: 0 20px 16px;
            padding: 10px 14px;
            background: #f8fafc;
            border-radius: 6px;
        }

        .terms-title {
            font-size: 9px;
            font-weight: 700;
            color: #374151;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .terms-text {
            font-size: 9px;
            color: #6b7280;
            line-height: 1.8;
        }

        /* ── FOOTER ── */
        .footer {
            background: #1e3a8a;
            padding: 14px 30px;
            text-align: center;
            margin-top: auto;
        }

        .footer-main {
            font-size: 11px;
            font-weight: 700;
            color: #fff;
            margin-bottom: 5px;
        }

        .footer-contact {
            font-size: 9px;
            color: #93c5fd;
            margin-bottom: 4px;
        }

        .footer-note {
            font-size: 8px;
            color: #6b9fd4;
        }
    </style>
</head>
<body>
<div class="page">

    <!-- ── HEADER ── -->
    <div class="header">
        <div>
            <div class="store-name">${STORE.name}</div>
            <div class="store-website">${STORE.website}</div>
        </div>
        <div class="header-right">
            <div class="invoice-title">TAX INVOICE</div>
            <div class="invoice-subtitle">Original for Recipient</div>
        </div>
    </div>

    <div class="accent-strip"></div>

    <!-- ── INVOICE DETAILS ── -->
    <div class="details-row">
        <div class="detail-cell">
            <div class="detail-label">Invoice No.</div>
            <div class="detail-value">${invoiceNo}</div>
        </div>
        <div class="detail-cell">
            <div class="detail-label">Invoice Date</div>
            <div class="detail-value">${invoiceDate}</div>
        </div>
        <div class="detail-cell">
            <div class="detail-label">Order ID</div>
            <div class="detail-value">${orderIdDisp}</div>
        </div>
        <div class="detail-cell">
            <div class="detail-label">Payment Method</div>
            <div class="detail-value">${isCOD ? "Cash on Delivery" : "Paid Online"}</div>
        </div>
    </div>

    <!-- ── ADDRESS SECTION ── -->
    <div class="address-section">
        <div class="address-box">
            <div class="address-header">Sold By</div>
            <div class="address-name">${STORE.name}</div>
            <div class="address-text">${STORE.address}</div>
            <div class="address-text">${STORE.email} | ${STORE.phone}</div>
            <div class="gstin-text">GSTIN: ${STORE.gstin}</div>
        </div>
        <div class="address-box">
            <div class="address-header">Billing Address</div>
            <div class="address-name">${order.address?.fullName || ""}</div>
            <div class="address-text">${order.address?.street || ""}</div>
            <div class="address-text">
                ${order.address?.city || ""}, ${order.address?.state || ""} - ${order.address?.pincode || ""}
            </div>
            <div class="address-text">Ph: ${order.address?.phone || ""}</div>
        </div>
        <div class="address-box">
            <div class="address-header">Shipping Address</div>
            <div class="address-name">${order.address?.fullName || ""}</div>
            <div class="address-text">${order.address?.street || ""}</div>
            <div class="address-text">
                ${order.address?.city || ""}, ${order.address?.state || ""} - ${order.address?.pincode || ""}
            </div>
            <div class="address-text">Ph: ${order.address?.phone || ""}</div>
        </div>
    </div>

    <!-- ── ITEMS TABLE ── -->
    <div class="items-section">
        <table>
            <thead>
                <tr>
                    <th class="col-sno">#</th>
                    <th class="col-item">Item Description</th>
                    <th class="col-qty">Qty</th>
                    <th class="col-price">Unit Price</th>
                    <th class="col-tax">Tax</th>
                    <th class="col-amount">Amount</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHTML}
            </tbody>
        </table>
    </div>

    <!-- ── TOTALS ── -->
    <div class="bottom-section">
        <div class="items-summary">
            Total Items: <span>${items.length}</span><br />
            Total Qty: <span>${totalQty}</span>
        </div>

        <div class="totals-box">
            <div class="total-row">
                <span class="total-label">Subtotal</span>
                <span class="total-value">${fmtPrice(order.subtotal)}</span>
            </div>
            <div class="total-row">
                <span class="total-label">Shipping</span>
                <span class="${order.shipping === 0 ? "free-tag" : "total-value"}">
                    ${order.shipping === 0 ? "FREE" : fmtPrice(order.shipping)}
                </span>
            </div>
            <div class="total-row">
                <span class="total-label">Tax / GST</span>
                <span class="total-value">Included</span>
            </div>
            <div class="grand-total-row">
                <span class="grand-total-label">TOTAL AMOUNT</span>
                <span class="grand-total-value">${fmtPrice(order.totalAmount)}</span>
            </div>
        </div>
    </div>

    <!-- ── PAYMENT NOTE ── -->
    <div class="payment-note ${isCOD ? "cod" : "paid"}">
        ${isCOD
            ? `💵 COD Order: Please keep ${fmtPrice(order.totalAmount)} ready at the time of delivery.`
            : `✅ Payment Received: ${fmtPrice(order.totalAmount)} via Online Payment.${order.paymentId ? ` &nbsp;|&nbsp; Ref: ${order.paymentId}` : ""}`
        }
    </div>

    <!-- ── TERMS ── -->
    <div class="terms">
        <div class="terms-title">Terms &amp; Conditions</div>
        <div class="terms-text">
            1. All prices are inclusive of applicable taxes.<br />
            2. Return/Exchange requests must be raised within 7 days of delivery.<br />
            3. This is a computer generated invoice and does not require a physical signature.
        </div>
    </div>

    <!-- ── FOOTER ── -->
    <div class="footer">
        <div class="footer-main">Thank you for shopping with ${STORE.name}!</div>
        <div class="footer-contact">${STORE.email} &nbsp;|&nbsp; ${STORE.phone} &nbsp;|&nbsp; ${STORE.website}</div>
        <div class="footer-note">This is a system generated document. No signature required.</div>
    </div>

</div>
</body>
</html>
    `;
};