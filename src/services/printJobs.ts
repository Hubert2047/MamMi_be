import type { IOrder } from '../models/order.js'
import PrintJob from '../models/print-job.js'

const typeLabel: Record<IOrder['type'], string> = {
    dine_in: '內用',
    takeaway: '外帶',
    uber: 'UBER',
    foodpanda: 'FOODPANDA',
}

function buildKitchenText(order: IOrder, item: IOrder['items'][number], index: number): string {
    const dateTime = new Date().toLocaleString('zh-TW', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    const lines = [
        `#${String(order.number).padStart(3, '0')}   ${typeLabel[order.type]}   ${dateTime}`,
        `${item.printName || item.name}${item.printVariant || item.variant ? ` (${item.printVariant || item.variant})` : ''} x${item.quantity}`,
    ]
    if (item.printNoteOptions?.length || item.noteOptions?.length) lines.push(`不加: ${(item.printNoteOptions || item.noteOptions).join(', ')}`)
    if (item.printAddons?.length || item.addons?.length) lines.push(`加點: ${(item.printAddons || item.addons).map((addon) => `${addon.printName || addon.name}${addon.amount > 1 ? ` x${addon.amount}` : ''}`).join(', ')}`)
    if (item.note) lines.push(`備註: ${item.note}`)
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
