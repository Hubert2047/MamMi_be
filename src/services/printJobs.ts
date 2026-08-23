import type { IOrder } from '../models/order.js'
import PrintJob from '../models/print-job.js'

const typeLabel: Record<IOrder['type'], string> = {
    dine_in: 'DINE IN',
    takeaway: 'TAKE AWAY',
    uber: 'UBER',
    foodpanda: 'FOODPANDA',
}

function buildKitchenText(order: IOrder, item: IOrder['items'][number], index: number): string {
    const dateTime = new Date().toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    const lines = [
        `#${String(order.number).padStart(3, '0')}   ${typeLabel[order.type]}   ${dateTime}`,
        `${item.name} x${item.quantity}`,
    ]
    if (item.variant) lines.push(`Loại: ${item.variant}`)
    if (item.noteOptions?.length) lines.push(`- ${item.noteOptions.join(', ')}`)
    if (item.addons?.length) lines.push(`+ ${item.addons.map((addon) => `${addon.name}${addon.amount > 1 ? ` x${addon.amount}` : ''}`).join(', ')}`)
    if (item.note) lines.push(`Ghi chú: ${item.note}`)
    lines.push(`${index + 1}/${order.items.length}`)
    return lines.join('\n')
}

export async function createKitchenPrintJobs(order: IOrder) {
    await PrintJob.create({
        storeId: order.storeId,
        orderId: order._id,
        kind: 'kitchen_item' as const,
        payload: { printableText: order.items.map((item, index) => buildKitchenText(order, item, index)).join('\f') },
    })
}
