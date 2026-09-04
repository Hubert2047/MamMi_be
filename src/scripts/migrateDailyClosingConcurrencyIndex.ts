import "dotenv/config";
import mongoose from "mongoose";
import DailyClosing from "../models/daily-closing.js";

const uri = process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI not set");

await mongoose.connect(uri, { dbName: "mammi" });

const duplicates = await DailyClosing.aggregate([
  { $match: { status: "confirmed" } },
  {
    $group: {
      _id: { storeId: "$storeId", periodStart: "$periodStart" },
      count: { $sum: 1 },
      closingIds: { $push: "$_id" },
    },
  },
  { $match: { count: { $gt: 1 } } },
]);
if (duplicates.length) {
  await mongoose.disconnect();
  throw new Error(
    `Cannot create closing concurrency index: ${duplicates.length} confirmed closing period(s) are duplicated. Void the duplicate records first: ${JSON.stringify(duplicates)}`,
  );
}

await DailyClosing.collection.createIndex(
  { storeId: 1, periodStart: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "confirmed" },
    name: "unique_confirmed_closing_period",
  },
);
console.log("Created unique confirmed closing period index");
await mongoose.disconnect();
