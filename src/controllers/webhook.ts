import type { Request, Response } from 'express'
import { Client } from '@line/bot-sdk'
import LineGroup from '../models/line-group.js'

export const handleWebhook = async (req: Request, res: Response) => {
    try {
        const config = {
            channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
            channelSecret: process.env.LINE_CHANNEL_SECRET!,
        }
        const client = new Client(config)
        const events = req.body.events
        if (!events || !events.length) return res.status(200).send('No events')

        await Promise.all(events.map(async (event: any) => {
            if (event.source?.type !== 'group' || typeof event.source.groupId !== 'string') return
            await LineGroup.updateOne(
                { lineGroupId: event.source.groupId },
                { $setOnInsert: { lineGroupId: event.source.groupId, name: 'LINE group', enabled: false, status: 'pending', notificationTypes: [] } },
                { upsert: true },
            )
        }))

        // await Promise.all(
        //     events.map(async (event: any) => {
        //         if (event.type === 'message' && event.message.type === 'text') {
        //             await client.replyMessage(event.replyToken, {
        //                 type: 'text',
        //                 text: `Bạn vừa gửi: ${event.message.text}`,
        //             })
        //         }
        //     }),
        // )

        res.status(200).send('OK')
    } catch (err: any) {
        console.error(err)
        res.status(500).send(err.message)
    }
}
