import type { IOrder } from '../models/order.js'
import Item from '../models/item.js'
import PrintJob from '../models/print-job.js'
import PrintRouting from '../models/print-routing.js'

const retentionMs = 7 * 24 * 60 * 60 * 1000

const typeLabel: Record<IOrder['type'], string> = {
    dine_in: '內用',
    takeaway: '外帶',
    uber: 'UBER',
    foodpanda: 'FOODPANDA',
}
const printableName = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback

function buildKitchenText(order: IOrder, item: IOrder['items'][number], index: number, totalItems: number, catalogName = ''): string {
    const dateTime = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(',', '')
    const tableLabel = order.type === 'dine_in' && String(order.table || '').trim() ? `(桌${String(order.table).trim()})` : ''
    const lines = [
        `#${String(order.number ?? '').padStart(3, '0')}    ${typeLabel[order.type] || ''}${tableLabel}    ${dateTime}`,
        `${printableName(item.printName || item.name || catalogName, '未命名商品')}${printableName(item.printVariant || item.variant, '') ? `(${printableName(item.printVariant || item.variant, '')})` : ''} x${item.quantity ?? 1}`,
    ]
    const noteOptions = item.printNoteOptions?.length ? item.printNoteOptions : item.noteOptions || []
    if (noteOptions.length) lines.push(`不加：${noteOptions.filter(Boolean).join('、')}`)
    const optionSelections = (item.optionSelections || []).map((selection) => selection.name || selection.optionId).filter(Boolean)
    if (optionSelections.length) lines.push(`選項：${optionSelections.join('、')}`)
    const addons = item.printAddons?.length ? item.printAddons : item.addons || []
    if (addons.length) lines.push(`加點：${addons.map((addon) => `${printableName(addon.printName || addon.name, '未命名加點')}${addon.amount > 1 ? ` x${addon.amount}` : ''}`).join('、')}`)
    if (item.note) lines.push(`備註：${item.note}`)
    lines.push(`${index + 1}/${totalItems}`)
    return lines.join('\n')
}

export async function createKitchenPrintJobs(order: IOrder) {
    const routing = await PrintRouting.findOne({ storeId: order.storeId }).select({ kitchenPrinterId: 1 }).lean()
    const orderData: any = typeof (order as any).toObject === 'function' ? (order as any).toObject() : order
    const printableItems = (orderData.items || [])
        .filter((item: any) => item.kitchenPrintEnabled !== false)
        .flatMap((item: any) => Array.from({ length: Math.max(1, Number(item.quantity) || 1) }, () => ({ ...item, quantity: 1 })))
    if (!printableItems.length) return
    const missingItemIds: string[] = [...new Set<string>(printableItems.filter((item: any) => !item.printName && !item.name && (item.itemId || item.id)).map((item: any) => String(item.itemId || item.id)))]
    const catalogItems = missingItemIds.length ? await Item.find({ _id: { $in: missingItemIds } }).select({ names: 1 }).lean() : []
    const catalogNames = new Map(catalogItems.map((item: any) => {
        const names = item.names instanceof Map ? Object.fromEntries(item.names) : item.names || {}
        return [String(item._id), names['zh-TW'] || names.vi || names.en || '']
    }))
    await PrintJob.create({
        storeId: order.storeId,
        ...(routing?.kitchenPrinterId ? { printerId: routing.kitchenPrinterId } : {}),
        orderId: order._id,
        kind: 'kitchen_item' as const,
        payload: { printableText: printableItems.map((item: any, index: number) => buildKitchenText(order, item, index, printableItems.length, catalogNames.get(String(item.itemId)) || '')).join('\f') },
        retentionUntil: new Date(Date.now() + retentionMs),
    })
}
