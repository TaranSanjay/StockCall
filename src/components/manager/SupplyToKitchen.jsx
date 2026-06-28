import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { logError } from '../../lib/logError'
import Navbar from '../shared/Navbar'

const MEAL_LABELS = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
  snacks: 'Snacks', other: 'Other',
}

const UNIT_NORM = { pcs: 'pieces', piece: 'pieces', L: 'litre', liters: 'litre', liter: 'litre',
                    dozen: 'dozens', pack: 'packets', packet: 'packets' }
function normUnit(u) { return UNIT_NORM[u] ?? u }

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const yy = String(dt.getFullYear()).slice(2)
  return `${dd}/${mm}/${yy}`
}

// ── "Supply All" item card (mobile) ───────────────────────────────────────────
function ItemCard({ item, quantities, reasons, errors, onQtyChange, onReasonChange }) {
  const qty     = Number(quantities[item.orderItemId])
  const differs = quantities[item.orderItemId] !== '' &&
                  item.requestedQty !== null &&
                  qty !== Number(item.requestedQty)
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
      <p className="text-base font-semibold text-gray-900">{item.itemName}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-500">
        {item.requestedQty !== null && (
          <><span>Originally requested</span><span className="text-gray-700 font-medium">{item.requestedQty} {item.unit}</span></>
        )}
        <span>Ordered from vendor</span>
        <span className="text-gray-700 font-medium">{item.orderedQty} {item.unit}</span>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500 whitespace-nowrap">Qty to Supply</label>
        <input
          type="number" min="0.5" step="0.5" onWheel={e => e.target.blur()}
          value={quantities[item.orderItemId] ?? ''}
          onChange={e => onQtyChange(item.orderItemId, e.target.value)}
          className={`w-28 border rounded-lg px-3 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
            errors[`qty_${item.orderItemId}`] ? 'border-red-400' : 'border-gray-300'
          }`}
        />
        <span className="text-sm text-gray-500">{item.unit}</span>
      </div>
      {errors[`qty_${item.orderItemId}`] && (
        <p className="text-sm text-red-600">{errors[`qty_${item.orderItemId}`]}</p>
      )}
      {differs && (
        <div>
          <p className="text-xs text-gray-500 mb-1">
            Requested: {item.requestedQty} {item.unit} · Ordered: {item.orderedQty} {item.unit} · Supplying: {quantities[item.orderItemId]} {item.unit}
          </p>
          <label className="block text-sm font-medium text-amber-700 mb-1.5">
            Why is the quantity different? <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={reasons[item.orderItemId] ?? ''}
            onChange={e => onReasonChange(item.orderItemId, e.target.value)}
            placeholder="e.g. only 8 kg available from vendor"
            className={`w-full border rounded-lg px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] ${
              errors[`reason_${item.orderItemId}`] ? 'border-red-400 bg-red-50' : 'border-amber-300 bg-amber-50'
            }`}
          />
          {errors[`reason_${item.orderItemId}`] && (
            <p className="text-sm text-red-600 mt-1">{errors[`reason_${item.orderItemId}`]}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── "Supply All" item row (desktop) ───────────────────────────────────────────
function ItemRow({ item, quantities, reasons, errors, onQtyChange, onReasonChange }) {
  const qty     = Number(quantities[item.orderItemId])
  const differs = quantities[item.orderItemId] !== '' &&
                  item.requestedQty !== null &&
                  qty !== Number(item.requestedQty)
  return (
    <tr className={differs ? 'bg-amber-50' : ''}>
      <td className="px-4 py-4 font-medium text-gray-900">{item.itemName}</td>
      <td className="px-4 py-4 text-right text-gray-500">
        {item.requestedQty !== null ? `${item.requestedQty} ${item.unit}` : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-4 py-4 text-right text-gray-500">{item.orderedQty} {item.unit}</td>
      <td className="px-4 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <input
            type="number" min="0.5" step="0.5" onWheel={e => e.target.blur()}
            value={quantities[item.orderItemId] ?? ''}
            onChange={e => onQtyChange(item.orderItemId, e.target.value)}
            className={`w-24 border rounded-lg px-2 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
              errors[`qty_${item.orderItemId}`] ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
          />
          <span className="text-sm text-gray-500">{item.unit}</span>
        </div>
        {errors[`qty_${item.orderItemId}`] && (
          <p className="text-sm text-red-600 mt-1 text-right">{errors[`qty_${item.orderItemId}`]}</p>
        )}
      </td>
      <td className="px-4 py-4 min-w-[200px]">
        {differs ? (
          <>
            <p className="text-xs text-gray-500 mb-1">
              Req: {item.requestedQty} {item.unit} · Ord: {item.orderedQty} {item.unit} · Sup: {quantities[item.orderItemId]} {item.unit}
            </p>
            <input
              type="text"
              value={reasons[item.orderItemId] ?? ''}
              onChange={e => onReasonChange(item.orderItemId, e.target.value)}
              placeholder="Explain the difference…"
              className={`w-full border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                errors[`reason_${item.orderItemId}`] ? 'border-red-400 bg-red-50' : 'border-amber-300'
              }`}
            />
            {errors[`reason_${item.orderItemId}`] && (
              <p className="text-sm text-red-600 mt-1">{errors[`reason_${item.orderItemId}`]}</p>
            )}
          </>
        ) : (
          <span className="text-gray-300 text-sm">—</span>
        )}
      </td>
    </tr>
  )
}

function ItemTable({ items, quantities, reasons, errors, onQtyChange, onReasonChange }) {
  return (
    <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
      <table className="w-full text-base">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500">Item</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Requested</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Ordered</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Qty to Supply</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500 min-w-[200px]">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(item => (
            <ItemRow key={item.orderItemId} item={item}
              quantities={quantities} reasons={reasons} errors={errors}
              onQtyChange={onQtyChange} onReasonChange={onReasonChange} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Checklist card (mobile, "select" mode) ────────────────────────────────────
function ChecklistCard({ item, checked, onToggle, quantities, reasons, errors, onQtyChange, onReasonChange }) {
  const qty     = Number(quantities[item.orderItemId])
  const differs = checked &&
                  quantities[item.orderItemId] !== '' &&
                  item.requestedQty !== null &&
                  qty !== Number(item.requestedQty)
  return (
    <div
      className={`bg-white rounded-xl border shadow-sm p-4 space-y-3 transition-colors ${
        checked ? 'border-blue-300' : 'border-gray-200'
      }`}
    >
      {/* Header row — always visible, tap to toggle */}
      <button
        type="button"
        onClick={() => onToggle(item.orderItemId)}
        className="w-full flex items-center gap-3 text-left"
      >
        <span className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
        }`}>
          {checked && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-base font-semibold ${checked ? 'text-gray-900' : 'text-gray-400'}`}>
            {item.itemName}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-0.5">
            {item.requestedQty !== null && <span>Requested: {item.requestedQty} {item.unit}</span>}
            <span>Ordered: {item.orderedQty} {item.unit}</span>
          </div>
        </div>
      </button>

      {/* Inputs — only when checked */}
      {checked && (
        <>
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-500 whitespace-nowrap">Qty to Supply</label>
            <input
              type="number" min="0.5" step="0.5" onWheel={e => e.target.blur()}
              value={quantities[item.orderItemId] ?? ''}
              onChange={e => onQtyChange(item.orderItemId, e.target.value)}
              className={`w-28 border rounded-lg px-3 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                errors[`qty_${item.orderItemId}`] ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            <span className="text-sm text-gray-500">{item.unit}</span>
          </div>
          {errors[`qty_${item.orderItemId}`] && (
            <p className="text-sm text-red-600">{errors[`qty_${item.orderItemId}`]}</p>
          )}
          {differs && (
            <div>
              <p className="text-xs text-gray-500 mb-1">
                Requested: {item.requestedQty} {item.unit} · Ordered: {item.orderedQty} {item.unit} · Supplying: {quantities[item.orderItemId]} {item.unit}
              </p>
              <label className="block text-sm font-medium text-amber-700 mb-1.5">
                Why is the quantity different? <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={reasons[item.orderItemId] ?? ''}
                onChange={e => onReasonChange(item.orderItemId, e.target.value)}
                placeholder="e.g. only 8 kg available from vendor"
                className={`w-full border rounded-lg px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] ${
                  errors[`reason_${item.orderItemId}`] ? 'border-red-400 bg-red-50' : 'border-amber-300 bg-amber-50'
                }`}
              />
              {errors[`reason_${item.orderItemId}`] && (
                <p className="text-sm text-red-600 mt-1">{errors[`reason_${item.orderItemId}`]}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Checklist row (desktop, "select" mode) ────────────────────────────────────
function ChecklistRow({ item, checked, onToggle, quantities, reasons, errors, onQtyChange, onReasonChange }) {
  const qty     = Number(quantities[item.orderItemId])
  const differs = checked &&
                  quantities[item.orderItemId] !== '' &&
                  item.requestedQty !== null &&
                  qty !== Number(item.requestedQty)
  return (
    <tr className={checked ? (differs ? 'bg-amber-50' : 'bg-blue-50/40') : 'opacity-50'}>
      {/* Checkbox */}
      <td className="px-4 py-4">
        <button
          type="button"
          onClick={() => onToggle(item.orderItemId)}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
          }`}
        >
          {checked && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>}
        </button>
      </td>
      <td className="px-4 py-4 font-medium text-gray-900">{item.itemName}</td>
      <td className="px-4 py-4 text-right text-gray-500">
        {item.requestedQty !== null ? `${item.requestedQty} ${item.unit}` : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-4 py-4 text-right text-gray-500">{item.orderedQty} {item.unit}</td>
      <td className="px-4 py-4 text-right">
        {checked ? (
          <>
            <div className="flex items-center justify-end gap-2">
              <input
                type="number" min="0.5" step="0.5" onWheel={e => e.target.blur()}
                value={quantities[item.orderItemId] ?? ''}
                onChange={e => onQtyChange(item.orderItemId, e.target.value)}
                className={`w-24 border rounded-lg px-2 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                  errors[`qty_${item.orderItemId}`] ? 'border-red-400 bg-red-50' : 'border-gray-300'
                }`}
              />
              <span className="text-sm text-gray-500">{item.unit}</span>
            </div>
            {errors[`qty_${item.orderItemId}`] && (
              <p className="text-sm text-red-600 mt-1 text-right">{errors[`qty_${item.orderItemId}`]}</p>
            )}
          </>
        ) : (
          <span className="text-gray-300 text-sm">—</span>
        )}
      </td>
      <td className="px-4 py-4 min-w-[200px]">
        {checked && differs ? (
          <>
            <p className="text-xs text-gray-500 mb-1">
              Req: {item.requestedQty} {item.unit} · Ord: {item.orderedQty} {item.unit} · Sup: {quantities[item.orderItemId]} {item.unit}
            </p>
            <input
              type="text"
              value={reasons[item.orderItemId] ?? ''}
              onChange={e => onReasonChange(item.orderItemId, e.target.value)}
              placeholder="Explain the difference…"
              className={`w-full border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                errors[`reason_${item.orderItemId}`] ? 'border-red-400 bg-red-50' : 'border-amber-300'
              }`}
            />
            {errors[`reason_${item.orderItemId}`] && (
              <p className="text-sm text-red-600 mt-1">{errors[`reason_${item.orderItemId}`]}</p>
            )}
          </>
        ) : (
          <span className="text-gray-300 text-sm">—</span>
        )}
      </td>
    </tr>
  )
}

function ChecklistTable({ items, checkedItems, onToggle, quantities, reasons, errors, onQtyChange, onReasonChange }) {
  return (
    <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
      <table className="w-full text-base">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-3 w-10" />
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500">Item</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Requested</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Ordered</th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Qty to Supply</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500 min-w-[200px]">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(item => (
            <ChecklistRow key={item.orderItemId} item={item}
              checked={checkedItems.has(item.orderItemId)}
              onToggle={onToggle}
              quantities={quantities} reasons={reasons} errors={errors}
              onQtyChange={onQtyChange} onReasonChange={onReasonChange} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SupplyToKitchen() {
  const { requestId }        = useParams()
  const { profile, signOut } = useAuth()
  const navigate             = useNavigate()

  const [request, setRequest]         = useState(null)
  const [chef, setChef]               = useState(null)
  const [order, setOrder]             = useState(null)
  const [items, setItems]             = useState([])
  const [quantities, setQuantities]   = useState({})
  const [reasons, setReasons]         = useState({})
  const [checkedItems, setChecked]    = useState(new Set())
  const [supplyMode, setSupplyMode]   = useState('all')
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(null)
  const [noOrder, setNoOrder]         = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [errors, setErrors]           = useState({})

  const onQtyChange    = (id, val) => setQuantities(prev => ({ ...prev, [id]: val }))
  const onReasonChange = (id, val) => setReasons(prev => ({ ...prev, [id]: val }))
  const onToggle       = (id) => setChecked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  useEffect(() => {
    const load = async () => {
      setLoadError(null)
      try {
        const { data: req, error: reqErr } = await supabase
          .from('requests').select('*').eq('id', requestId).single()
        if (reqErr) throw reqErr
        if (!req) { setLoading(false); return }
        setRequest(req)

        const { data: chefProfile, error: profErr } = await supabase
          .from('profiles').select('id, full_name').eq('id', req.chef_id).single()
        if (profErr) throw profErr
        setChef(chefProfile)

        const { data: orders, error: ordErr } = await supabase
          .from('orders').select('id, vendor_name, placed_at').eq('request_id', requestId)
        if (ordErr) throw ordErr
        if (!orders?.length) { setNoOrder(true); setLoading(false); return }
        const ord = orders[0]
        setOrder(ord)

        const { data: orderItems, error: oiErr } = await supabase
          .from('order_items')
          .select('id, item_name, request_item_id, quantity_ordered, unit')
          .eq('order_id', ord.id)
        if (oiErr) throw oiErr
        if (!orderItems?.length) { setLoading(false); return }

        const reqItemIds = orderItems.map(oi => oi.request_item_id).filter(Boolean)
        const { data: reqItems, error: riErr } = reqItemIds.length
          ? await supabase.from('request_items').select('id, quantity, unit').in('id', reqItemIds)
          : { data: [], error: null }
        if (riErr) throw riErr
        const reqMap = Object.fromEntries((reqItems ?? []).map(ri => [ri.id, ri]))

        const { data: supplyLogs, error: slErr } = await supabase
          .from('supply_logs').select('order_item_id')
          .in('order_item_id', orderItems.map(oi => oi.id))
        if (slErr) throw slErr
        const suppliedIds = new Set((supplyLogs ?? []).map(sl => sl.order_item_id))

        const unsupplied = orderItems
          .filter(oi => !suppliedIds.has(oi.id))
          .map(oi => ({
            orderItemId:  oi.id,
            itemName:     oi.item_name,
            requestedQty: reqMap[oi.request_item_id]?.quantity ?? null,
            orderedQty:   oi.quantity_ordered,
            unit:         oi.unit,
          }))

        setItems(unsupplied)

        const qtyInit = {}
        unsupplied.forEach(i => { qtyInit[i.orderItemId] = String(i.orderedQty) })
        setQuantities(qtyInit)

        setLoading(false)
      } catch {
        setLoadError('Something went wrong. Please refresh and try again.')
        setLoading(false)
      }
    }
    load()
  }, [requestId])

  // ── Validation ──────────────────────────────────────────────────────────────
  const validateItem = (item) => {
    const errs = {}
    const qty  = Number(quantities[item.orderItemId])
    if (!quantities[item.orderItemId] || qty <= 0)
      errs[`qty_${item.orderItemId}`] = 'Enter a quantity.'
    if (
      item.requestedQty !== null &&
      qty !== Number(item.requestedQty) &&
      !reasons[item.orderItemId]?.trim()
    ) errs[`reason_${item.orderItemId}`] = 'Please explain the difference.'
    return errs
  }

  // ── DB helpers ──────────────────────────────────────────────────────────────
  const submitItem = async (item) => {
    const qtySupplied = Number(quantities[item.orderItemId])
    const reason      = reasons[item.orderItemId]?.trim() || null
    const unit        = normUnit(item.unit)

    // Update storage BEFORE inserting supply_log so that if storage fails,
    // supply_log is never committed and the item stays visible for retry.
    let remainingToConsume = qtySupplied

    const { data: ownStorage, error: ownStorErr } = await supabase
      .from('storage_log')
      .select('id, quantity_in_storage')
      .eq('order_item_id', item.orderItemId)
      .eq('is_available', true)
      .limit(1)
    if (ownStorErr) throw ownStorErr

    if (ownStorage?.length) {
      const row       = ownStorage[0]
      const inStorage = Number(row.quantity_in_storage)
      if (remainingToConsume >= inStorage) {
        const { error } = await supabase.from('storage_log').update({ is_available: false }).eq('id', row.id)
        if (error) throw error
        remainingToConsume -= inStorage
      } else {
        const { error } = await supabase.from('storage_log').update({ quantity_in_storage: inStorage - remainingToConsume }).eq('id', row.id)
        if (error) throw error
        remainingToConsume = 0
      }
    }

    if (remainingToConsume > 0) {
      const { data: otherRows, error: otherErr } = await supabase
        .from('storage_log')
        .select('id, quantity_in_storage')
        .eq('item_name', item.itemName)
        .eq('is_available', true)
        .neq('order_item_id', item.orderItemId)
        .order('date_stored', { ascending: true })
      if (otherErr) throw otherErr
      for (const row of otherRows ?? []) {
        if (remainingToConsume <= 0) break
        const qty = Number(row.quantity_in_storage)
        if (remainingToConsume >= qty) {
          const { error } = await supabase.from('storage_log').update({ is_available: false }).eq('id', row.id)
          if (error) throw error
          remainingToConsume -= qty
        } else {
          const { error } = await supabase.from('storage_log').update({ quantity_in_storage: qty - remainingToConsume }).eq('id', row.id)
          if (error) throw error
          remainingToConsume = 0
        }
      }
    }

    if (remainingToConsume > 0) {
      throw new Error(
        `Could not account for ${remainingToConsume} ${unit} of ${item.itemName} in storage. Supply cancelled — please check storage manually.`
      )
    }

    // Insert supply_log only after storage is successfully updated
    const { error: slErr } = await supabase.from('supply_logs').insert({
      order_item_id:     item.orderItemId,
      supplied_by:       profile.id,
      supplied_at:       new Date().toISOString(),
      quantity_supplied: qtySupplied,
      unit,
      difference_reason: reason,
    })
    if (slErr) throw slErr
  }

  // Supply All at Once
  const handleSubmitAll = async () => {
    const errs = items.reduce((acc, item) => ({ ...acc, ...validateItem(item) }), {})
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setSubmitting(true)
    try {
      for (const item of items) await submitItem(item)
      navigate('/orders')
    } catch (err) {
      logError('SupplyToKitchen', err.message, { requestId, orderId: order?.id, mode: 'all' })
      setErrors({ submit: err.message })
      setSubmitting(false)
    }
  }

  // Supply selected items from checklist
  const handleSubmitSelected = async () => {
    const selected = items.filter(i => checkedItems.has(i.orderItemId))
    if (!selected.length) {
      setErrors({ submit: 'Tick at least one item to supply.' })
      return
    }
    const errs = selected.reduce((acc, item) => ({ ...acc, ...validateItem(item) }), {})
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setSubmitting(true)
    try {
      for (const item of selected) await submitItem(item)
      navigate('/orders')
    } catch (err) {
      logError('SupplyToKitchen', err.message, { requestId, orderId: order?.id, mode: 'select' })
      setErrors({ submit: err.message })
      setSubmitting(false)
    }
  }

  // ── Render states ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar profile={profile} onSignOut={signOut} />
        <div className="max-w-3xl mx-auto px-4 py-6 sm:px-6">
          <p className="text-red-600 text-sm text-center py-4">{loadError}</p>
        </div>
      </div>
    )
  }

  if (noOrder) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar profile={profile} onSignOut={signOut} />
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-4xl">📋</p>
          <p className="text-base text-gray-500">No order has been placed for this request yet.</p>
          <button
            onClick={() => navigate(`/requests/${requestId}/order`)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-5 py-3 rounded-xl min-h-[48px] transition-colors"
          >
            Place Order First
          </button>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar profile={profile} onSignOut={signOut} />
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-4xl">✅</p>
          <p className="text-base text-gray-500">All items have been supplied to the kitchen.</p>
          <button
            onClick={() => navigate('/orders')}
            className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-5 py-3 rounded-xl min-h-[48px] transition-colors"
          >
            Back to Orders
          </button>
        </div>
      </div>
    )
  }

  const itemProps = { quantities, reasons, errors, onQtyChange, onReasonChange }
  const selectedCount = items.filter(i => checkedItems.has(i.orderItemId)).length

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-3xl mx-auto px-4 py-6 sm:px-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="min-h-[44px] min-w-[44px] flex items-center text-gray-500 hover:text-gray-800 text-base transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-xl font-bold text-gray-900">Supply to Kitchen</h1>
        </div>

        {/* Context */}
        {request && chef && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-base text-gray-700">
              <span><span className="text-gray-400 text-sm font-semibold uppercase tracking-wider mr-1.5">Requester</span>{chef.full_name}</span>
              {request.meal_purpose
                ? <span><span className="text-gray-400 text-sm font-semibold uppercase tracking-wider mr-1.5">Purpose</span>{MEAL_LABELS[request.meal_purpose] ?? request.meal_purpose}</span>
                : <span><span className="text-gray-400 text-sm font-semibold uppercase tracking-wider mr-1.5">Department</span><span className="bg-teal-100 text-teal-700 text-xs rounded-full px-2 py-0.5">🧹 Housekeeping</span></span>
              }
              {order?.vendor_name && (
                <span><span className="text-gray-400 text-sm font-semibold uppercase tracking-wider mr-1.5">Vendor</span>{order.vendor_name}</span>
              )}
              {order?.placed_at && (
                <span><span className="text-gray-400 text-sm font-semibold uppercase tracking-wider mr-1.5">Order Date</span>{fmtDate(order.placed_at)}</span>
              )}
            </div>
          </div>
        )}

        {/* Mode toggle */}
        <div className="flex bg-gray-100 p-1 rounded-xl mb-5">
          {[['all', 'Supply All at Once'], ['one', 'Select Items to Supply']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => { setSupplyMode(val); setErrors({}); setChecked(new Set()) }}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${
                supplyMode === val ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── SUPPLY ALL AT ONCE ─────────────────────────────────────── */}
        {supplyMode === 'all' && (
          <>
            <div className="md:hidden space-y-3 mb-5">
              {items.map(item => (
                <ItemCard key={item.orderItemId} item={item} {...itemProps} />
              ))}
            </div>
            <ItemTable items={items} {...itemProps} />
            {errors.submit && (
              <p className="text-base text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
                {errors.submit}
              </p>
            )}
            <button
              onClick={handleSubmitAll}
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold text-base py-4 rounded-xl min-h-[56px] transition-colors mb-8"
            >
              {submitting ? 'Marking as supplied…' : 'Mark All as Supplied'}
            </button>
          </>
        )}

        {/* ── SELECT ITEMS TO SUPPLY ─────────────────────────────────── */}
        {supplyMode === 'one' && (
          <>
            {selectedCount > 0 && (
              <p className="text-sm text-blue-700 font-medium mb-3">
                {selectedCount} of {items.length} item{items.length !== 1 ? 's' : ''} selected
              </p>
            )}

            <div className="md:hidden space-y-3 mb-5">
              {items.map(item => (
                <ChecklistCard
                  key={item.orderItemId}
                  item={item}
                  checked={checkedItems.has(item.orderItemId)}
                  onToggle={onToggle}
                  {...itemProps}
                />
              ))}
            </div>

            <ChecklistTable
              items={items}
              checkedItems={checkedItems}
              onToggle={onToggle}
              {...itemProps}
            />

            {errors.submit && (
              <p className="text-base text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
                {errors.submit}
              </p>
            )}
            <button
              onClick={handleSubmitSelected}
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold text-base py-4 rounded-xl min-h-[56px] transition-colors mb-8"
            >
              {submitting
                ? 'Saving…'
                : selectedCount > 0
                  ? `Supply ${selectedCount} Selected Item${selectedCount !== 1 ? 's' : ''}`
                  : 'Supply Selected Items'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
