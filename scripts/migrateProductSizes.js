// scripts/migrateProductSizes.js
// ─── Ek baar chalao: node scripts/migrateProductSizes.js ───

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const migrate = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    const db = mongoose.connection.db;
    const products = await db.collection("products").find({}).toArray();

    console.log(`📦 Found ${products.length} products\n`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const product of products) {

      // ── Already migrated check ──
      const alreadyMigrated = product.colors?.some(c => Array.isArray(c.sizes) && c.sizes.length > 0);
      if (alreadyMigrated) {
        console.log(`⏭️  Skipping (already migrated): ${product.name}`);
        skipped++;
        continue;
      }

      const globalSizes = product.sizes || [];

      if (globalSizes.length === 0) {
        console.log(`⚠️  No sizes found for: ${product.name} — adding empty sizes`);
      }

      // ── Move global sizes into each color ──
      const updatedColors = (product.colors || []).map(color => ({
        _id: color._id,
        colorName: color.colorName,
        images: color.images || [],
        sizes: globalSizes.map(s => ({
          _id: new mongoose.Types.ObjectId(),
          size: s.size?.toUpperCase() || s.size,
          stock: Number(s.stock) || 0,
        })),
      }));

      try {
        await db.collection("products").updateOne(
          { _id: product._id },
          {
            $set: { colors: updatedColors },
            $unset: { sizes: "" },  // ← global sizes hata do
          }
        );

        console.log(
          `✅ Migrated: ${product.name}` +
          ` — ${updatedColors.length} color(s)` +
          ` × ${globalSizes.length} size(s)`
        );
        migrated++;

      } catch (updateErr) {
        console.error(`❌ Failed: ${product.name} — ${updateErr.message}`);
        errors++;
      }
    }

    console.log("\n══════════════════════════════════");
    console.log(`  Migration Summary`);
    console.log(`══════════════════════════════════`);
    console.log(`  ✅ Migrated : ${migrated}`);
    console.log(`  ⏭️  Skipped  : ${skipped}`);
    console.log(`  ❌ Errors   : ${errors}`);
    console.log(`  📦 Total    : ${products.length}`);
    console.log(`══════════════════════════════════\n`);

    if (errors > 0) {
      console.log("⚠️  Some products failed — check errors above");
    } else {
      console.log("🎉 All products migrated successfully!");
    }

  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
    process.exit(0);
  }
};

migrate();