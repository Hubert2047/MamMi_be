import { Client } from "@line/bot-sdk";
import LineGroup from "../models/line-group.js";
import StoreLineGroupConfig from "../models/store-line-group-config.js";

export const sendMessageToGroup = async (
  groupId: string,
  text: string,
): Promise<boolean> => {
  const client = new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
    channelSecret: process.env.LINE_CHANNEL_SECRET!,
  });

  try {
    await client.pushMessage(groupId, {
      type: "text",
      text,
    });
    return true;
  } catch (error) {
    console.error("Gửi tin thất bại:", error);
    return false;
  }
};

export const sendMessageToConfiguredGroups = async (
  storeId: string,
  text: string,
) => {
  const config = await StoreLineGroupConfig.findOne({ storeId })
    .select({ dailyClosingLineGroupId: 1 })
    .lean();
  if (!config?.dailyClosingLineGroupId) return;
  const group = await LineGroup.findOne({
    _id: config.dailyClosingLineGroupId,
    storeId,
    usageStatus: "assigned",
  })
    .select({ lineGroupId: 1 })
    .lean();
  if (group) await sendMessageToGroup(group.lineGroupId, text);
};
