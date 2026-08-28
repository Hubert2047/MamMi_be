import { Client } from '@line/bot-sdk'
import LineGroup, { type LineNotificationType } from '../models/line-group.js'

export const sendMessageToGroup = async (groupId: string, text: string): Promise<boolean> => {
    const client = new Client({
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
        channelSecret: process.env.LINE_CHANNEL_SECRET!,
    })

    try {
        await client.pushMessage(groupId, {
            type: 'text',
            text,
        })
        return true
    } catch (error) {
        console.error('Gửi tin thất bại:', error)
        return false
    }
}

export const sendMessageToConfiguredGroups = async (storeId: string, type: LineNotificationType, text: string) => {
    const groups = await LineGroup.find({ storeId, status: 'active', enabled: true, notificationTypes: type }).select({ lineGroupId: 1 }).lean()
    await Promise.all(groups.map((group) => sendMessageToGroup(group.lineGroupId, text)))
}
