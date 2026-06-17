import * as XLSX from 'xlsx'

export function downloadShoppingList(items, chefName, date) {
  const rows = [
    ['#', 'Item Name', 'Required Quantity', 'Unit'],
    ...items.map((item, i) => [i + 1, item.item_name, item.quantity, item.unit]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Shopping List')
  const safeName = (chefName ?? 'chef').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
  XLSX.writeFile(wb, `shopping-list-${safeName}-${date}.xlsx`)
}
