# Backend Documentation — node-backend

Project location: `c:\Users\Ashish\node-backend`

This document describes every functionality, route, model, background job, and integration found in the Node.js backend codebase.

---

## 1. Tech Stack

**Runtime & Framework**
- Node.js (ESM — `"type": "module"` in package.json), entry point `index.js`
- Express 5.1 (`express`)
- `body-parser`, `cookie-parser`, `cors`

**Database**
- MongoDB via Mongoose 8.18 (`mongoose.set('debug', true)` enabled in `config/db.js`)
- Redis (`redis` v5 client in `config/redis.js`) — used for caching (products, categories, wishlist, dashboard stats) and as the BullMQ backing store

**Auth**
- `jsonwebtoken` — access token (15 min) + refresh token (7 days), both stored in httpOnly cookies (`accessToken`, `refreshToken`)
- `bcrypt` — password hashing
- Refresh tokens are SHA-256 hashed (`crypto`) before being stored on the User document (`refreshToken` field, `select:false`)

**Payments**
- `razorpay` SDK — order creation, webhook signature verification, refunds

**Email**
- `nodemailer` is present in deps but the actual send path uses the **Brevo transactional email HTTP API** (`https://api.brevo.com/v3/smtp/email`) inside a BullMQ worker (`utils/emailQueue.js`), not SMTP/nodemailer directly. Both `SMTP_*` and `BREVO_API_KEY` env vars exist.

**File Upload / Media**
- `multer` (memory storage for CSV uploads; custom Cloudinary streaming storage engine for product/category/banner images)
- `cloudinary` — image/video hosting, custom `CloudinaryEngine` class implementing multer's `StorageEngine` interface to stream-upload directly to Cloudinary
- `xlsx`, `csv-parse`, `csv-parser` — Excel/CSV parsing for bulk product/FAQ upload

**Background Jobs / Queues**
- `bullmq` — three named queues: `emailQueue`, `bulkUploadQueue` (products), `faqBulkUploadQueue`, all backed by Redis
- `node-cron` — in-process scheduled jobs (cart expiry, order expiry, stock monitor, pending-order reconciliation)

**PDF / Documents**
- `puppeteer` — renders invoice HTML to PDF (headless Chromium)
- `pdfkit`, `qrcode` — present in deps but not observed wired into any controller — likely available for future/partial invoice features

**Monitoring / Logging**
- `@sentry/node` — error tracking, initialized in `instrument.js`, imported first in `index.js`; `Sentry.setupExpressErrorHandler(app)` wired after routes
- `winston` + `winston-daily-rotate-file` — structured JSON logging to console (`utils/logger.js` currently only configures a Console transport despite the daily-rotate-file dependency being installed)

**Validation / Security**
- `express-validator` (dependency present; not observed used directly in controllers — validation is mostly manual/inline)
- `express-rate-limit` — multiple named limiters
- `cors` with an explicit allow-list
- `slugify` — slug generation for categories/subcategories/products

**npm scripts**:
- `start`: `node --import ./config/instrument.js index.js`
- `dev`: `nodemon index.js`
- `test`: placeholder only (`echo "Error: no test specified" && exit 1`) — **no test suite exists**

---

## 2. Project Structure

```
node-backend/
├── index.js                # App bootstrap: Express app, CORS, cron jobs, webhook route; mounts routes/index.js at /api
├── config/
│   ├── cloudinary.js         # Cloudinary SDK config from env
│   ├── multer.js             # Multer + custom Cloudinary streaming storage engine, per-use-case upload middlewares
│   ├── db.js                 # Mongoose connection
│   ├── instrument.js         # Sentry.init() — imported first for instrumentation
│   ├── redis.js              # Redis client singleton (connects eagerly at import time)
│   └── razorpay.js           # getRazorpay() — lazy Razorpay client singleton, shared across controllers
├── controllers/
│   ├── admin/                # 17 controller files — dashboard, products, categories, subcategories, orders,
│   │                          #   payments, returns, inventory, customers, notifications, contact, FAQ (+bulk
│   │                          #   upload), lookbook, promo banners, failed emails, Sentry error viewer
│   └── user/                 # 16 controller files — auth, address, cart, cart items, categories, subcategories,
│                              #   products, orders, payment, wallet, wishlist, returns, lookbook (read), FAQ (read),
│                              #   contact, invoice, promo banner (read)
├── jobs/
│   ├── expireOrders.js       # Cron: expires stale pending orders, releases stock + wallet
│   ├── reconcilePending.js   # Cron: alerts admin about long-stuck pending orders (no longer mutates state)
│   └── stockMonitor.js       # Cron: hourly low/out-of-stock scan → admin notifications
├── middleware/
│   ├── auth.js                # authenticate (JWT from cookie) + isAdmin
│   ├── globalErrorHandler.js  # Central error → JSON response mapper
│   └── rateLimiter.js         # Named rate limiters (public, admin, auth, otp, payment, bulk upload)
├── models/                   # 17 Mongoose models (see section 3)
├── routes/
│   ├── index.js               # Aggregates every route module into one router, mounted at /api in index.js
│   ├── admin/                 # 17 route files mirroring controllers/admin
│   └── user/                  # 16 route files mirroring controllers/user
├── scripts/                   # One-off/maintenance Node scripts (not part of the running server), e.g.:
│                               #   reconcileOrphanedCartItems.js, backfillAttributeFields.js, backfillDeliveredAt.js,
│                               #   backfillFaqNormalized.js, cleanupUnverifiedUsers.js, dropDedupeIndex.js,
│                               #   findReservedSourcesDeep.js, fixAvailableField.js, fixBannerEndDate.js,
│                               #   fixStock.js, flush-wishlist-cache.js, migrateAvailable.js, migrateProductSizes.js,
│                               #   migrateWishlist.js, reconcileExpiredOrderStock.js
│                               # — ad hoc data-migration/cleanup utilities run manually via `node scripts/xyz.js`,
│                               #   evidence of iterative schema fixes. All read MONGODB_URI (no alternate var names).
├── services/
│   ├── inventoryService.js          # Core stock engine: reserveStock/releaseStock/deductStock/restockItem +
│   │                                 #   releaseExpiredCartStock cron logic
│   ├── orderConfirmationService.js  # confirmPaidOrder — shared by webhook + client-verify path
│   ├── checkoutService.js           # Cart validation/pricing, stale-order cleanup, "new order" notification —
│   │                                 #   used by controllers/user/paymentController.js
│   ├── adminInventoryService.js     # Admin inventory listing/filtering aggregation + stock-update validation —
│   │                                 #   used by controllers/admin/adminInventoryController.js
│   ├── productMutationService.js    # applyProductUpdate() — the ~10 in-place product edit operations —
│   │                                 #   used by controllers/admin/adminProductController.js
│   ├── bulkUploadEngine.js          # ChunkedBulkUploader class — shared BullMQ queue/worker/Redis-progress engine
│   │                                 #   behind both product and FAQ bulk upload
│   ├── offer.js                     # calculateoffer() — time-windowed discount logic
│   ├── productHelpers.js            # Redis cache keys/TTLs, buildProductFilter, parseColors, safeParse
│   └── faqBulkUpload.js             # FAQ-specific validator/notifications, instantiates ChunkedBulkUploader
├── utils/
│   ├── AppError.js            # Custom operational error class + factory helpers
│   ├── bulkUploadQueue.js     # Product-specific validator/image-session helpers, instantiates ChunkedBulkUploader
│   ├── emailQueue.js          # BullMQ email queue/worker (Brevo API via axios)
│   ├── generateToken.js       # JWT access/refresh token generation + refresh-token hashing
│   ├── invoiceTemplate.js     # Generates full invoice HTML (used by Puppeteer)
│   ├── logger.js              # Winston logger
│   ├── notifyAdmin.js         # Admin notification creation + dedupe + critical/high email alerting
│   ├── pricing.js             # getEffectivePrice() — offer-aware price calc (alt/simpler version of offer.js)
│   ├── riskFlags.js           # OTP/reset/return-rate abuse detection → notifyAdmin
│   └── shipping.js            # Flat shipping (₹49 below ₹999) + COD fee (₹30) calculators
└── tmp_uploads/                # Multer disk destination for temp FAQ CSV/Excel uploads before parsing (gitignored)
```

---

## 3. Database Models

| Model | Key Fields | Relationships / Notes |
|---|---|---|
| **User** | name, email (unique), password (bcrypt), otp/otpExpires/otpRequestCount (+reset equivalents), isVerified, role (`user`/`admin`), isBlocked/blockedReason/blockedAt, addresses (embedded array), walletBalance, walletReserved, refreshToken (hashed, `select:false`) | Addresses embedded (not a separate collection). Wishlist intentionally **removed** from User (migrated to its own collection). |
| **Address** | fullName, phone, pincode, state, city, addressData, landmark, isDefault | Embedded schema reused inside `User.addresses[]`. |
| **Product** | name (unique), slug (unique), subcategory (ref), category (ref), description, details, colors[] → each with colorName, images[], sizes[] (`{size, stock, reserved, available}`), price, video/videoVisible, offer/offerStart/offerEnd, newArrival, type/material/fit/pattern/sleeve/collar | `available` is **never settable directly** — a `pre("validate")` hook always recomputes `available = stock - reserved` for every size on every save/insert, making it a derived/invariant field. Virtuals: `totalStock`, `isOutOfStock`, `totalReserved`. Heavily indexed (slug, subcategory, offer window, text search, per-size stock/available). |
| **Category** | name (unique), slug (unique), image | Top of the category → subcategory → product hierarchy. |
| **Subcategory** | name (unique), category (ref), slug (unique), image, sizeChart {unit, rows[]} | Products reference Subcategory, not Category, directly. |
| **Cart** | user (ref), status (`active|ordered|expired|processing`), expiresAt (30-min TTL, refreshable), deleteAfter (TTL index), processingJobId/processingStartedAt (cron claim-lock fields) | One active cart per user at a time. |
| **CartItem** | cart (ref), product (ref), quantity, selectedColor, selectedSize | Line items live in a separate collection from Cart (not embedded). |
| **Order** | user (ref), cart (ref, required), idempotencyKey (unique, sparse), address (snapshot), items[] (snapshot), subtotal/shipping/tax/totalAmount, invoiceNumber, razorpayOrderId/paymentId, paymentStatus (`pending|paid|failed|cod|expired`), stockReleased (guard flag), paymentMethod (`wallet|razorpay|wallet+razorpay|cod`), walletUsed, orderStatus (`placed|processing|shipped|delivered|cancelled|returned`), deliveredAt, cancelReason/cancelledBy/cancelledAt, codFee, failureReason | Central transactional document; heavily indexed for user history, admin filters, webhook lookup, and idempotency checks. |
| **WishlistItem** | userId (ref), productId (ref), color, addedAt | Unique compound index `(userId, productId, color)` — DB-level guard against duplicate wishlist entries. |
| **ReturnRequest** | user (ref), order (ref), items[] (snapshot), reason (enum), description, refundAmount, refundMethod (`wallet|razorpay|bank_transfer|upi`), bankDetails{}, status (`pending|approved|rejected`), rejectionReason, processedAt/processedBy, razorpayRefundId | Unique compound index `(order, user)` — one return request per order per user. |
| **WalletTransaction** | user (ref), type (`credit|debit`), amount, balanceAfter, reason (enum: return_approved/order_payment/admin_credit/admin_debit — code also uses `"wallet_release"` which is **not** in the enum), description, orderId (ref), returnId (ref) | Immutable ledger; every wallet mutation writes one of these. |
| **AdminNotification** | type (enum), severity, title, message, link, data (Mixed), read, dedupeKey, emailSent | TTL indexes auto-expire read notifications after 90 days and unread ones after 180 days. Code emits several types not in the declared enum. |
| **ContactMessage** | name, email, orderId, subject, message, status (`new|in_progress|resolved`), resolutionNote | Public contact-form submissions. |
| **FailedEmail** | to, subject, html, reason, attempts, status (`failed|resent|resolved`), resentAt | Dead-letter store for emails that exhausted BullMQ retries. |
| **Faq** | question, questionNormalized (unique — case-insensitive dedupe), answer, topic | Auto-derives `questionNormalized` via pre-save hooks. |
| **LookBook** | sections[] → {title, slug, products[] (ref Product), order} | Single document holding all curated homepage sections. |
| **PromoBanner** | imageUrl, imagePublicId, startDate, endDate, isActive, linkUrl | Only one banner active at a time (enforced in controller, not schema). |

---

## 4. API Routes / Endpoints

All routes are mounted in `index.js` under `/api/...`. **[Auth]** = `authenticate` (JWT cookie), **[Admin]** = `authenticate + isAdmin`.

### Auth — `/api/auth`
- `GET /me` [Auth] — current user
- `POST /signup` [authLimiter] — create unverified user, email OTP, deletes any prior unverified record for same email
- `POST /verify-otp` [otpLimiter] — verify OTP, mark verified, issue access+refresh cookies
- `POST /login` [authLimiter] — bcrypt compare, blocked-user check, issue cookies
- `POST /logout` [Auth] — clear refresh token in DB + clear cookies
- `POST /resendOtp` [otpLimiter] — 2-min cooldown + daily cap (5/day)
- `POST /forgot-password` [authLimiter] — hashed reset token (15-min expiry), email reset link, daily cap, triggers `checkResetRisk`
- `POST /reset-password/:token` [authLimiter] — validate hashed token + expiry, set new password
- `POST /refresh-token` [authLimiter] — validate refresh cookie, reissue access token

### Address — `/api/address` (all [Auth])
- `POST /` [publicLimiter], `GET /`, `GET /:addressId`, `PATCH /:addressId` [publicLimiter], `DELETE /:addressId`

### Cart / Cart Items — `/api/cart`, `/api/cart-items` (all [Auth])
- `GET /cart/my-cart`, `PATCH /cart/:cartId/ordered`
- `POST /cart-items` [publicLimiter] — atomically reserves stock
- `GET /cart-items/:cartId`, `PATCH /cart-items/:cartItemId`, `DELETE /cart-items/:cartItemId`, `DELETE /cart-items/clear/:cartId`

### Categories / Subcategories — `/api/categories`, `/api/subcategories` (public, cached)
- `GET /categories`, `GET /categories/:categorySlug`, `GET /subcategories`, `GET /subcategories/:categorySlug`

### Products — `/api/products` (public, cached)
- `GET /offers`, `GET /new-arrivals`, `GET /videos`, `GET /category/:categorySlug`, `GET /single/:productslug`, `GET /:subcategoryslug` (filterable/sortable listing)

### Orders — `/api/orders` (all [Auth])
- `GET /my-orders`, `GET /:orderId/invoice` (Puppeteer PDF), `GET /:id`

### Payment — `/api/payment`
- `POST /create` [Auth][paymentLimiter] — Razorpay order, wallet-aware, idempotent
- `POST /cod` [Auth][paymentLimiter]
- `POST /verify` [Auth][publicLimiter] — signature check → `confirmPaidOrder()`
- `GET /order/:id` [Auth]
- `POST /api/payment/webhook` (mounted before `express.json()`, `express.raw()`) — Razorpay webhook, HMAC-SHA256 + `timingSafeEqual`

### Wallet — `/api/wallet` (all [Auth])
- `GET /` [publicLimiter] — balance, reserved amount, last 20 transactions

### Wishlist — `/api/wishlist` (all [Auth])
- `GET /` — Redis-cached (5 min), `POST /add`, `POST /remove`, `POST /clear` (all [publicLimiter])

### Returns — `/api/returns` (all [Auth])
- `POST /` [publicLimiter] — only delivered orders within 7-day window; `GET /my-returns`, `GET /order/:orderId`

### Lookbook / FAQs / Contact / Promo Banner (public)
- `GET /api/lookbook/`, `GET /api/faqs/` + `/topics`, `POST /api/contact/` [publicLimiter], `GET /api/promo-banner/active`

### Admin Routes (all [Admin] + adminLimiter unless noted)

- **Dashboard** `/api/admin/dashboard` — `GET /stats`, `GET /revenue-chart`, `GET /recent-orders`, `GET /top-products`, `GET /orders`, `PATCH /orders/:id/status`
- **Products** `/api/admin/products` — full CRUD, `GET /ids` (bulk-select), `PATCH /bulk-update`, `PATCH /products/:productId/toggle-video`
- **Bulk Upload** `/api/admin/products/bulk-upload` — `GET /template`, `POST /` [bulkUploadLimiter], `POST /json`, `POST /images`, `GET /status/:jobId`, `GET /images/:sessionId`
- **Categories/Subcategories** `/api/admin/categories`, `/api/admin/subcategories` — full CRUD + Cloudinary image handling + cache invalidation; subcategory adds `PATCH /:slug/size-chart`
- **Inventory** `/api/admin/inventory` — `GET /` (flat variant list + stats), `PATCH /stock`, `PATCH /bulk-stock` (up to 500 variants)
- **Orders** `/api/admin/orders` — `GET /`, `GET /:id`, `PATCH /:id/status`, `GET /:id/invoice`, `GET /returns`, `PATCH /returns/:id/approve`, `PATCH /returns/:id/reject`
- **Returns** `/api/admin/returns` — `GET /`, `GET /:returnId`, `PATCH /:returnId/approve` (transactional, restocks items), `PATCH /:returnId/reject`
- **Payments** `/api/admin/payments` — `GET /stats`, `GET /failed`, `GET /new-count`, `PATCH /:id/mark-paid`
- **Customers** `/api/admin/customers` — `GET /`, `GET /:id`, `PATCH /:id/block`
- **FAQs (admin)** `/api/admin/faqs` — full CRUD + duplicate guard, `POST /bulk-upload`, `GET /bulk-upload/:groupId/status`
- **Contact (admin)** `/api/admin/contact` — `GET /`, `GET /:id`, `PATCH /:id/status`, `DELETE /:id`
- **Notifications** `/api/admin/notifications` — `GET /`, `GET /unread-count`, `PATCH /read-all`, `PATCH /:id/read`
- **Errors (Sentry proxy)** `/api/admin/errors` — `GET /`, `GET /:issueId`
- **Failed Emails** — `GET /failed-emails`, `POST /failed-emails/:id/resend`
- **Promo Banners (admin)** `/api/admin/promo-banner` — full CRUD, only one banner active at a time
- **Lookbook (admin)** `/api/admin/lookbook` — `GET /`, `POST /init`, `POST /sections`, `PATCH /sections/:id`, `DELETE /sections/:id`, `POST /sections/:id/products`, `DELETE /sections/:id/products/:productId`

---

## 5. Business Logic / Key Functional Flows

**Authentication & Authorization** — JWT-based, no server-side sessions. Access token (15 min) + refresh token (7 days) as httpOnly cookies. Refresh tokens are SHA-256 hashed before persisting so a DB leak doesn't expose usable tokens. `authenticate` decodes the token, loads the user, and blocks the request if `isBlocked`. `isAdmin` gates on `role === "admin"`. Signup requires OTP email verification; unverified duplicate signups auto-delete the stale record. OTP/reset flows have per-user rate limiting (cooldowns + daily caps) plus abuse detection (`riskFlags.js`) that alerts admins of excessive OTP/reset requests.

**Cart & Inventory Reservation** — Stock is tracked per product/color/size as `{stock, reserved, available}`, where `available` is a Mongoose-enforced invariant recomputed in a `pre("validate")` hook. `services/inventoryService.js` implements four atomic operations, all single `findOneAndUpdate` calls (no read-then-write race window):
- `reserveStock` — atomic conditional decrement of `available`/increment of `reserved` (add-to-cart, quantity increase)
- `releaseStock` — aggregation-pipeline update capping `available` at `stock` (cart-item removal/clear, cart expiry)
- `deductStock` — decrements both `stock` and `reserved` (payment/COD confirmation)
- `restockItem` — increments `stock` and capped `available` (return approval, order cancellation)

**Cart Expiry & Stock Release Cron** — `releaseExpiredCartStock()` runs every 5 min via `node-cron`, using a claim-based two-phase design safe against overlapping runs/crashes: recovers stale "processing" carts (>5 min stuck) back to "active"; atomically claims expired active carts with a fresh `jobId`; batch-fetches all CartItems; releases stock per item via `Promise.allSettled`, only marking the cart expired if **all** releases succeed, otherwise resetting to "active" for retry — guaranteeing no stock leak on partial failure.

**Order Expiry Cron** — `jobs/expireOrders.js` runs every 10 min, targeting orders stuck `pending` for >20 minutes. Inside a Mongo transaction (with transient-error retry/backoff), it releases item stock, credits back reserved wallet amount, and flips the order to `expired`. `jobs/reconcilePending.js` is a separate, non-mutating watchdog (every 15 min) that only alerts admins about stuck orders — deliberately split from the mutating job to avoid two jobs both trying to mutate order status.

**Checkout / Payment Flow** — `createPaymentOrder` runs inside a Mongo transaction with layered idempotency: reuses/expires an existing pending order tied to the same cart; checks a client-supplied `idempotencyKey` against a unique index, handling duplicate-key races by returning the winning order. Wallet usage is verified server-side. If wallet fully covers the total, the order is confirmed instantly with no Razorpay order created. If Razorpay is needed, any wallet portion is only reserved (`walletReserved`), not debited, until `confirmPaidOrder()` runs — the single shared path used by both the webhook (`payment.captured`) and the client `/verify` fallback. COD orders deduct stock and finalize immediately.

**Webhook Handling** — Mounted before `express.json()`, using `express.raw()`, because HMAC signature verification requires the raw body. Signature check uses `crypto.timingSafeEqual`. The handler always returns HTTP 200 (even on internal errors) to prevent Razorpay retry storms.

**Returns & Refunds** — `createReturnRequest` enforces: order must be delivered, within 7 days, one return per order, and refund-method-specific required fields. `approveReturn` is transactional with an atomic `pending → "approving"` claim to prevent double-approval, branches by refund method (wallet credit / Razorpay refund / manual bank/UPI note), restocks every item, and marks the order `returned`. A background check flags high-return-rate customers.

**Wallet** — Ledger model: every credit/debit writes a `WalletTransaction` alongside updating `User.walletBalance`/`walletReserved`. `walletReserved` prevents double-spending across simultaneous checkouts, converted to a real debit on confirmation or refunded on expiry.

**Email Queue & Notifications** — All outbound email goes through a BullMQ queue rather than being sent inline. The worker (concurrency 5, 3 retries with exponential backoff) sends via the Brevo REST API with a 15-second timeout. Jobs that exhaust retries persist to `FailedEmail` and trigger an `EMAIL_FAILED` admin notification, resendable via the admin panel. `utils/notifyAdmin.js` supports a `dedupeKey` + time-window mechanism so noisy conditions don't spam admins, and auto-emails admins for `critical`/`high` severity only.

**Inventory / Restocking & Stock Monitoring** — `jobs/stockMonitor.js` runs hourly, firing deduplicated `OUT_OF_STOCK`/`LOW_STOCK` admin notifications (threshold: 5 units). Admin manual stock edits use aggregation-pipeline updates (not `arrayFilters`+`$set`) because recomputing `available` needs to reference the sibling `reserved` field within the same array element.

**Bulk Upload (Products & FAQs)** — Chunked-BullMQ pattern: parse CSV/Excel synchronously, split into chunks of 25, enqueue one job per chunk, track completion in Redis by `groupId`, aggregate and send one consolidated admin notification once done. Product bulk upload supports a two-step "upload images first" workflow (images uploaded to Cloudinary independently, CSV/JSON references images by filename). Both handle `insertMany({ordered:false})` partial failures by cross-referencing `err.insertedDocs` against `err.writeErrors` indices.

**Search / Filtering / Pagination** — Product listing supports color/size/price-range/pattern filters and sort options, returning the full set of available colors/patterns for the subcategory (unfiltered) so the filter UI doesn't collapse options. Admin listings uniformly implement `page`/`limit` pagination with clamps and return `total`/`totalPages`.

**Caching** — Redis read-through cache with 5–10 min TTLs for categories, subcategories, product listings/detail/new-arrivals/videos/offers, wishlist, lookbook, and dashboard stats. Invalidation via explicit `del`/pattern-`keys`+`del` calls inside mutation controllers, not TTL alone.

**Rate Limiting** — Seven `express-rate-limit` instances scoped by use case: `publicLimiter` (100/10min), `authLimiter` (10/15min), `otpLimiter` (5/15min), `adminLimiter` (200/10min), `bulkUploadLimiter` (10/hour), `paymentLimiter` (20/15min), `searchLimiter` (60/5min) — all IP-keyed, uniform 429 JSON body.

---

## 6. Middleware

- **`middleware/auth.js`** — `authenticate` (JWT-from-cookie, loads/attaches `req.user`, rejects blocked users) and `isAdmin`. No auto-refresh in middleware — a 401 with `code: "TOKEN_EXPIRED"` signals the frontend to call `/refresh-token`.
- **`middleware/globalErrorHandler.js`** — single handler mounted after all routes. Maps `AppError` → structured JSON; Mongoose `ValidationError` → 400; duplicate-key (`11000`) → 409; `CastError` → 400; anything else → generic 500, logged via Winston.
- **`middleware/rateLimiter.js`** — described above.
- **File upload** — `config/multer.js` exports pre-configured multer instances per use case using a custom `CloudinaryEngine` storage class that streams buffers straight to Cloudinary. Bulk-upload CSV/Excel routes use plain memory/disk storage since those files are parsed, not served.
- **Security** — `cors` with an explicit origin allow-list (env-driven `CLIENT_URL`/`ADMIN_URL` + hardcoded localhost/Vercel URLs) with credentials enabled; no `helmet` dependency present.
- **Sentry** — `Sentry.setupExpressErrorHandler(app)` registered after routes but before the custom global error handler.

---

## 7. Config / Environment Variables

- `MONGODB_URI`, `PORT`
- `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_CLOUD_NAME`
- `REDIS_URL`
- `JWT_SECRET_KEY`, `JWT_REFRESH_SECRET_KEY`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `STORE_NAME`, `STORE_EMAIL`, `STORE_PHONE`, `STORE_ADDRESS`, `STORE_GSTIN`, `STORE_WEBSITE` (invoice branding)
- `ADMIN_EMAIL`, `ADMIN_PANEL_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL` (only `SMTP_FROM_EMAIL` is actually used, as the Brevo "sender" address)
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_BACKEND_PROJECT_SLUG`, `SENTRY_FRONTEND_PROJECT_SLUG`
- `NODE_ENV`
- Referenced in code but **absent from `.env.example`**: `BREVO_API_KEY`, `CLIENT_URL`, `ADMIN_URL`

No app-wide config file beyond `cloudinary.js`/`multer.js` — everything reads `process.env.*` directly at point of use.

---

## 8. Third-Party Integrations

- **Razorpay** — payment orders, webhook-driven capture confirmation, refunds
- **Cloudinary** — image/video storage (products, categories, subcategories, promo banners)
- **Brevo (Sendinblue) Transactional Email API** — actual email delivery mechanism
- **Sentry** — error monitoring (SDK) + REST API consumption (admin error dashboard)
- **Redis** — cache + BullMQ job broker

---

## 9. Error Handling & Logging

- **Error handling** — custom `AppError` class with `statusCode`/`code`/`isOperational`, plus an `Errors` factory (cartNotFound, productNotFound, insufficientStock, etc.). Many controllers still use inline `res.status(x).json(...)` rather than throwing `AppError`, so error-shape consistency varies. Mongo transactions (orders, returns) wrapped in `try/catch/finally` with explicit `abortTransaction()`/`endSession()`.
- **Logging** — Winston with JSON + timestamp formatting to console only (no file transport wired despite the daily-rotate-file dependency). All raw `console.log`/`console.error` debug statements have been removed in favor of the Winston logger.
- **Process-level safety net** — `unhandledRejection`/`uncaughtException` handlers log via Winston and gracefully shut down the HTTP server before `process.exit(1)`.
- **Admin-facing error visibility** — `/api/admin/errors` proxies Sentry's issue APIs so admins can view frontend and backend production errors independent of the DB-backed `AdminNotification` system.

---

## 10. Testing

**No automated test suite exists.** The `test` npm script is a placeholder, no test framework is a dependency, and no `*.test.js`/`*.spec.js` files exist. The closest thing to verification tooling is `scripts/*.js` — one-off maintenance/migration/backfill scripts, run manually.

---

## 11. Known Issues Spotted During Review

Fixed as of the latest cleanup passes: broken `start` script, `WalletTransaction`/`AdminNotification` enum gaps, leftover `console.log` debug instrumentation, undocumented env vars, the duplicated-path bug in `adminPaymentRoutes.js`/`adminProductRoutes.js`, unprotected public routes, the `lib/redis.js`/root `db.js`/`instrument.js` folder placement, the broken product-video-upload field parsing, a duplicate/dead `updateOrderStatus` (removed in favor of the one real path), and three real transactional races:

- **`jobs/expireOrders.js`** could stamp a just-confirmed-paid order back to `"expired"` (a TOCTOU race between its initial `.find()` and its final unconditional update) — fixed by making the expiry an atomic claim (`findOneAndUpdate` conditional on `paymentStatus: "pending"`) done *before* releasing stock/crediting wallet, mirroring how `confirmPaidOrder` claims the same document.
- **`controllers/admin/adminReturnController.js`**'s Razorpay refund could fire twice on a retry, because the "claim" that guards against double-approval used to live inside the same transaction as the refund call — if anything after the refund failed, the whole transaction (claim included) rolled back, leaving the return re-approvable. Fixed by committing the claim before the refund call, and — once money has actually moved — never releasing that claim on a later failure (it's flagged via `notifyAdmin` for manual review instead).
- **`services/inventoryService.js`**'s cart-expiry cron (`releaseExpiredCartStock`) had no awareness of an in-flight payment: a cart could expire (releasing stock, deleting items) while a Razorpay payment against it was still completing, leaving a paid order stuck `"pending"` forever and reselling stock that was actually sold. Fixed by excluding any cart with a currently-`"pending"` `Order` from the expiry sweep.
- **`controllers/admin/adminOrderController.js`**'s order cancellation never restocked items or refunded the wallet-paid portion — stock and money were silently lost on every admin cancellation. Fixed: cancellation now atomically claims the order, restocks items (if payment had gone through), refunds any wallet-used amount, and flags any Razorpay-captured remainder via `notifyAdmin` for a manual refund (auto-refunding that externally isn't safe without the same claim-based idempotency the return-approval fix above required, and a status PATCH has no natural retry boundary to protect against firing that call twice).

Remaining known gaps (flagged, not fixed — both need a deliberate design decision rather than a quick patch):
1. **No reconciliation against the Razorpay API before auto-expiring a stuck-pending order** (`jobs/expireOrders.js`). If a webhook is delayed/lost past the 20-minute cutoff and the customer never completes client-side verification either, a genuinely paid order gets auto-"expired" — the wallet portion is refunded, but the Razorpay-captured cash isn't reconciled anywhere, and once "expired" it no longer shows up in `reconcilePending.js`'s alerting query either.
2. **`confirmPaidOrder` has no retry wrapper for transient write conflicts** beyond what `session.withTransaction()` provides natively (it was converted from manual `start/commit/abort` to `withTransaction()` this pass specifically to gain that built-in retry — this item is effectively closed, kept here as a note that it wasn't given the extra explicit `withRetry` wrapper `jobs/expireOrders.js` has, since `withTransaction`'s built-in retry already covers the same class of error).
3. Product video uploads read the uploaded file from the `uploadProductMedia.any()` flat file array by filtering on `fieldname === "video"` — matches the frontend's `fd.append("video", file)` today, but if that field name ever changes, this silently breaks with no validation error.

### Key file references
- Cart/stock reservation core: `services/inventoryService.js`
- Order/payment transaction logic: `controllers/user/paymentController.js`, `services/orderConfirmationService.js`
- Cron jobs: `jobs/expireOrders.js`, `jobs/reconcilePending.js`, `jobs/stockMonitor.js`
- Email queue: `utils/emailQueue.js`
- Wishlist race-condition fix: `controllers/user/wishlistController.js`, `models/WishlistItem.js`
- App bootstrap/routing: `index.js`
