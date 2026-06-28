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

const PRICE_UNITS = ['g', 'kg', 'ml', 'litre', 'pieces', 'dozens', 'packets']
const GST_OPTIONS  = [0, 5, 12, 18, 28, 40]

const UNIT_NORM = { pcs: 'pieces', piece: 'pieces', L: 'litre', liters: 'litre', liter: 'litre',
                    dozen: 'dozens', pack: 'packets', packet: 'packets' }
function normUnit(u) { return UNIT_NORM[u] ?? u }

function getUnitOptions(itemUnit) {
  return PRICE_UNITS.includes(itemUnit) ? PRICE_UNITS : [itemUnit, ...PRICE_UNITS]
}

function fmt(dateStr) {
  if (!dateStr) return '—'
  const d   = new Date(dateStr)
  const dd  = String(d.getDate()).padStart(2, '0')
  const mm  = String(d.getMonth() + 1).padStart(2, '0')
  const yy  = String(d.getFullYear()).slice(2)
  const hh  = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yy}, ${hh}:${min}`
}

const PAYMENT_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Credit Card' }

// amountPaid is the inclusive (after-GST) amount the user entered
function calcItem(amountPaid, gstPercent) {
  const a    = Number(amountPaid) || 0
  const rate = Number(gstPercent) / 100
  const base = rate > 0 ? a / (1 + rate) : a
  return { base, tax: a - base, amountPaid: a }
}

// ── Existing order read-only view ─────────────────────────────────────────────
function ExistingOrderView({ order, requestId, navigate, profile, signOut, allSupplied }) {
  const orderItems  = order.order_items ?? []
  const orderGstPct = Number(order.gst_percent) || 0  // fallback for old orders

  const itemCalc = (oi) => {
    const base   = (Number(oi.price_per_unit) || 0) * (Number(oi.quantity_ordered) || 0)
    const gstPct = oi.gst_percent != null ? Number(oi.gst_percent) : orderGstPct
    const amountPaid = base * (1 + gstPct / 100)
    return { base, tax: amountPaid - base, amountPaid, gstPct }
  }

  const calcs           = orderItems.map(oi => itemCalc(oi))
  const totalCartPreTax = calcs.reduce((s, c) => s + c.base, 0)
  const taxableAmount   = calcs.filter(c => c.gstPct > 0).reduce((s, c) => s + c.base, 0)
  const nonTaxable      = calcs.filter(c => c.gstPct === 0).reduce((s, c) => s + c.base, 0)
  const taxAmount       = calcs.reduce((s, c) => s + c.tax, 0)
  const grandTotal      = calcs.reduce((s, c) => s + c.amountPaid, 0)
  const paymentLabel    = order.payment_method ? (PAYMENT_LABELS[order.payment_method] ?? order.payment_method) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />
      <div className="max-w-3xl mx-auto px-4 py-6 sm:px-6">

        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="min-h-[44px] min-w-[44px] flex items-center text-gray-500 hover:text-gray-800 text-base transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-xl font-bold text-gray-900">Order Details</h1>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <p className="text-base font-semibold text-amber-800">Order already logged.</p>
          <p className="text-sm text-amber-700 mt-1">
            Vendor: <span className="font-medium">{order.vendor_name}</span>
            {order.placed_at && <span className="ml-3 text-amber-500">{fmt(order.placed_at)}</span>}
          </p>
          {order.notes && <p className="text-sm text-amber-600 mt-1">Notes: {order.notes}</p>}
        </div>

        {/* Items table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-4">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500">Item</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Base (₹)</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Paid (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orderItems.map((oi, idx) => {
                const { base, amountPaid, gstPct } = calcs[idx]
                return (
                  <tr key={oi.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-gray-900 font-medium">{oi.item_name}</p>
                        {gstPct > 0 ? (
                          <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-medium">{gstPct}% GST</span>
                        ) : (
                          <span className="bg-orange-100 text-orange-600 text-xs px-2 py-0.5 rounded-full font-medium">No Tax</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400">{oi.quantity_ordered}{oi.unit}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">₹{base.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-semibold">₹{amountPaid.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 mb-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-base text-gray-600">Total Cart Value (Pre-Tax)</span>
            <span className="text-base font-medium text-gray-700">₹{totalCartPreTax.toFixed(2)}</span>
          </div>
          {taxableAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-base text-gray-600">Taxable Amount</span>
              <span className="text-base text-gray-700">₹{taxableAmount.toFixed(2)}</span>
            </div>
          )}
          {nonTaxable > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-base text-gray-600">Non-Taxable Amount</span>
              <span className="text-base text-gray-700">₹{nonTaxable.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-base text-gray-600">Tax Amount</span>
            <span className="text-base text-gray-700">₹{taxAmount.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <span className="text-base font-semibold text-gray-700">Grand Total</span>
            <span className="text-xl font-bold text-gray-900">₹{grandTotal.toFixed(2)}</span>
          </div>
        </div>

        {paymentLabel && (
          <div className="mb-5">
            <span className="text-sm text-gray-500">Paid via: </span>
            <span className="bg-gray-100 text-gray-900 text-sm font-semibold px-3 py-1 rounded-full">{paymentLabel}</span>
          </div>
        )}

        {!allSupplied ? (
          <button
            onClick={() => navigate(`/requests/${requestId}/supply`)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base py-4 rounded-xl min-h-[56px] transition-colors"
          >
            Go to Supply →
          </button>
        ) : (
          <p className="text-green-600 text-sm font-medium text-center py-2">
            ✅ All items have been supplied to the kitchen.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PlaceOrder() {
  const { requestId }        = useParams()
  const { profile, signOut } = useAuth()
  const navigate             = useNavigate()

  const [request, setRequest]             = useState(null)
  const [chef, setChef]                   = useState(null)
  const [approvedItems, setApprovedItems] = useState([])
  const [existingOrder, setExistingOrder] = useState(null)
  const [allSupplied, setAllSupplied]     = useState(false)
  const [vendorName, setVendorName]       = useState('')
  const [orderNotes, setOrderNotes]       = useState('')
  const [prices, setPrices]               = useState({})          // itemId → amountPaid string
  const [orderQtys, setOrderQtys]         = useState({})
  const [orderQtyUnits, setOrderQtyUnits] = useState({})
  const [itemGstRates, setItemGstRates]   = useState({})          // itemId → gst% number
  const [paymentMethod, setPaymentMethod] = useState('')
  const [loading, setLoading]             = useState(true)
  const [loadError, setLoadError]         = useState(null)
  const [submitting, setSubmitting]       = useState(false)
  const [errors, setErrors]               = useState({})

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

        const { data: items, error: itemErr } = await supabase
          .from('request_items').select('*')
          .eq('request_id', requestId).eq('item_status', 'approved')
        if (itemErr) throw itemErr
        setApprovedItems(items ?? [])

        const initPrices   = {}
        const initQtys     = {}
        const initQtyUnits = {}
        const initGstRates = {}
        ;(items ?? []).forEach(i => {
          initPrices[i.id]    = ''
          initQtys[i.id]      = String(i.quantity)
          initQtyUnits[i.id]  = i.unit
          initGstRates[i.id]  = 5
        })
        setPrices(initPrices)
        setOrderQtys(initQtys)
        setOrderQtyUnits(initQtyUnits)
        setItemGstRates(initGstRates)

        const { data: orders, error: ordErr } = await supabase
          .from('orders').select('*, order_items(*)').eq('request_id', requestId)
        if (ordErr) throw ordErr
        if (orders?.length) {
          setExistingOrder(orders[0])
          const orderItemIds = (orders[0].order_items ?? []).map(oi => oi.id)
          if (orderItemIds.length) {
            const { data: supplyLogs } = await supabase
              .from('supply_logs').select('order_item_id')
              .in('order_item_id', orderItemIds)
            const suppliedIds = new Set((supplyLogs ?? []).map(sl => sl.order_item_id))
            setAllSupplied(orderItemIds.every(id => suppliedIds.has(id)))
          }
        }

        setLoading(false)
      } catch {
        setLoadError('Something went wrong. Please refresh and try again.')
        setLoading(false)
      }
    }
    load()
  }, [requestId])

  const getCalc = (item) => calcItem(prices[item.id], itemGstRates[item.id] ?? 5)

  const allCalcs        = approvedItems.map(item => getCalc(item))
  const totalCartPreTax = allCalcs.reduce((s, c) => s + c.base, 0)
  const taxableAmount   = approvedItems.reduce((s, item, i) =>
    (itemGstRates[item.id] ?? 5) > 0 ? s + allCalcs[i].base : s, 0)
  const nonTaxableAmount = approvedItems.reduce((s, item, i) =>
    (itemGstRates[item.id] ?? 5) === 0 ? s + allCalcs[i].base : s, 0)
  const taxAmount  = allCalcs.reduce((s, c) => s + c.tax, 0)
  const grandTotal = allCalcs.reduce((s, c) => s + c.amountPaid, 0)

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!approvedItems.length) {
      setErrors({ submit: 'No approved items to order. All items in this request were rejected.' })
      return
    }
    const errs = {}
    if (!vendorName.trim()) errs.vendorName    = 'Vendor name is required.'
    if (!paymentMethod)     errs.paymentMethod  = 'Please select a payment method.'
    approvedItems.forEach(item => {
      const p = Number(prices[item.id])
      if (!prices[item.id] || p <= 0) errs[`price_${item.id}`] = 'Enter an amount greater than 0.'
      const q = Number(orderQtys[item.id])
      if (!orderQtys[item.id] || q <= 0) errs[`qty_${item.id}`] = 'Enter a quantity greater than 0.'
      const g = Number(itemGstRates[item.id])
      if (!GST_OPTIONS.includes(g)) errs[`gst_${item.id}`] = 'Invalid GST rate.'
    })
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setSubmitting(true)

    try {
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({
          request_id:     requestId,
          placed_by:      profile.id,
          vendor_name:    vendorName.trim(),
          notes:          orderNotes.trim() || null,
          placed_at:      new Date().toISOString(),
          payment_method: paymentMethod,
        })
        .select('id').single()
      if (orderErr) throw orderErr

      const { data: insertedItems, error: itemErr } = await supabase.from('order_items').insert(
        approvedItems.map(item => {
          const oq      = Number(orderQtys[item.id]) || item.quantity
          const ou      = normUnit(orderQtyUnits[item.id] || item.unit)
          const gstPct  = Number(itemGstRates[item.id] ?? 5)
          const { base } = calcItem(prices[item.id], gstPct)
          return {
            order_id:         order.id,
            request_item_id:  item.id,
            item_name:        item.item_name,
            quantity_ordered: oq,
            unit:             ou,
            price_per_unit:   base / oq,
            gst_percent:      gstPct,
          }
        })
      ).select('id, item_name, quantity_ordered, unit')

      if (itemErr) {
        await supabase.from('orders').delete().eq('id', order.id)
        throw itemErr
      }

      if (insertedItems?.length) {
        const today = new Date().toISOString().split('T')[0]
        const { error: storErr } = await supabase.from('storage_log').insert(
          insertedItems.map(oi => ({
            order_item_id:       oi.id,
            item_name:           oi.item_name,
            quantity_in_storage: oi.quantity_ordered,
            unit:                oi.unit,
            date_stored:         today,
            is_available:        true,
          }))
        )
        if (storErr) {
          logError('PlaceOrder/storage_init', storErr.message, { orderId: order.id })
          setErrors({ submit: 'Order was saved but storage log failed to update. Please contact your manager.' })
          setSubmitting(false)
          return
        }
      }

      navigate(`/requests/${requestId}/supply`)
    } catch (err) {
      logError('PlaceOrder', err.message, {
        requestId,
        vendorName: vendorName.trim(),
        itemCount:  approvedItems.length,
      })
      setErrors({ submit: err.message })
      setSubmitting(false)
    }
  }

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
        <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6">
          <p className="text-red-600 text-sm text-center py-4">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!existingOrder && approvedItems.length === 0 && request) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar profile={profile} onSignOut={signOut} />
        <div className="max-w-3xl mx-auto px-4 py-6 sm:px-6">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => navigate(-1)}
              className="min-h-[44px] min-w-[44px] flex items-center text-gray-500 hover:text-gray-800 text-base transition-colors"
            >
              ← Back
            </button>
            <h1 className="text-xl font-bold text-gray-900">Place Order</h1>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-base font-semibold text-amber-800 mb-1">All items in this request were rejected.</p>
            <p className="text-sm text-amber-700">There are no approved items to order.</p>
          </div>
        </div>
      </div>
    )
  }

  if (existingOrder) {
    return (
      <ExistingOrderView
        order={existingOrder}
        requestId={requestId}
        navigate={navigate}
        profile={profile}
        signOut={signOut}
        allSupplied={allSupplied}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="min-h-[44px] min-w-[44px] flex items-center text-gray-500 hover:text-gray-800 text-base transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-xl font-bold text-gray-900">Place Order</h1>
        </div>

        {/* Request summary */}
        {request && chef && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-base text-gray-700">
              <span><span className="text-gray-400 text-sm font-semibold uppercase tracking-wider mr-1.5">Requester</span>{chef.full_name}</span>
              {request.meal_purpose
                ? <span><span className="text-gray-400 text-sm font-semibold uppercase tracking-wider mr-1.5">Purpose</span>{MEAL_LABELS[request.meal_purpose] ?? request.meal_purpose}</span>
                : <span><span className="text-gray-400 text-sm font-semibold uppercase tracking-wider mr-1.5">Department</span><span className="bg-teal-100 text-teal-700 text-xs rounded-full px-2 py-0.5">🧹 Housekeeping</span></span>
              }
            </div>
          </div>
        )}

        {/* Vendor + notes */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5 space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">
              Vendor Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={vendorName}
              onChange={e => setVendorName(e.target.value)}
              placeholder="e.g. Sunrise Wholesale"
              className={`w-full border rounded-lg px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] ${
                errors.vendorName ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.vendorName && <p className="text-base text-red-600 mt-1">{errors.vendorName}</p>}
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">
              Order Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={orderNotes}
              onChange={e => setOrderNotes(e.target.value)}
              rows={2}
              placeholder="Any delivery instructions or notes…"
              className="w-full border border-gray-300 rounded-lg px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Items — mobile cards */}
        <div className="md:hidden space-y-3 mb-4">
          {approvedItems.map(item => {
            const gstPct = itemGstRates[item.id] ?? 5
            const { base, amountPaid } = getCalc(item)
            return (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{item.item_name}</p>
                    <p className="text-sm text-gray-400">Requested: {item.quantity}{item.unit}</p>
                  </div>
                  {amountPaid > 0 && (
                    <div className="text-right">
                      <p className="text-base font-semibold text-gray-900">₹{amountPaid.toFixed(2)}</p>
                      <p className="text-xs text-gray-400">Base ₹{base.toFixed(2)}</p>
                    </div>
                  )}
                </div>

                {/* Qty + Unit */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm text-gray-500 whitespace-nowrap w-10">Qty</span>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    onWheel={e => e.target.blur()}
                    value={orderQtys[item.id]}
                    onChange={e => setOrderQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className={`flex-1 border rounded-lg px-3 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                      errors[`qty_${item.id}`] ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  <select
                    value={orderQtyUnits[item.id] || item.unit}
                    onChange={e => setOrderQtyUnits(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className="border border-gray-300 rounded-lg px-2 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                  >
                    {getUnitOptions(item.unit).map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                {errors[`qty_${item.id}`] && <p className="text-sm text-red-600 mb-1">{errors[`qty_${item.id}`]}</p>}

                {/* Amount Paid + GST % */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-gray-500 whitespace-nowrap w-10">₹</span>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    onWheel={e => e.target.blur()}
                    value={prices[item.id]}
                    onChange={e => setPrices(prev => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="Amount paid"
                    className={`flex-1 border rounded-lg px-3 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                      errors[`price_${item.id}`] ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  <select
                    value={gstPct}
                    onChange={e => setItemGstRates(prev => ({ ...prev, [item.id]: Number(e.target.value) }))}
                    className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                  >
                    {GST_OPTIONS.map(g => <option key={g} value={g}>{g}% GST</option>)}
                  </select>
                </div>
                {errors[`price_${item.id}`] && <p className="text-sm text-red-600 mb-1">{errors[`price_${item.id}`]}</p>}
                {Number(prices[item.id]) > 0 && (
                  <p className="text-xs text-gray-500 pl-10">Base: ₹{base.toFixed(2)}</p>
                )}
              </div>
            )
          })}
        </div>

        {/* Items — desktop table */}
        <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-4">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500">Item</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Qty</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500">Unit</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Amount Paid (₹)</th>
                <th className="text-center px-4 py-3 text-sm font-semibold text-gray-500">GST %</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Base (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {approvedItems.map(item => {
                const gstPct = itemGstRates[item.id] ?? 5
                const { base } = getCalc(item)
                return (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{item.item_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Req: {item.quantity}{item.unit}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          onWheel={e => e.target.blur()}
                          value={orderQtys[item.id]}
                          onChange={e => setOrderQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className={`w-24 border rounded-lg px-2 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                            errors[`qty_${item.id}`] ? 'border-red-400 bg-red-50' : 'border-gray-300'
                          }`}
                        />
                      </div>
                      {errors[`qty_${item.id}`] && (
                        <p className="text-xs text-red-600 mt-1 text-right">{errors[`qty_${item.id}`]}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={orderQtyUnits[item.id] || item.unit}
                        onChange={e => setOrderQtyUnits(prev => ({ ...prev, [item.id]: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-2 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                      >
                        {getUnitOptions(item.unit).map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          onWheel={e => e.target.blur()}
                          value={prices[item.id]}
                          onChange={e => setPrices(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Amount paid"
                          className={`w-32 border rounded-lg px-2 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                            errors[`price_${item.id}`] ? 'border-red-400 bg-red-50' : 'border-gray-300'
                          }`}
                        />
                      </div>
                      {errors[`price_${item.id}`] && (
                        <p className="text-xs text-red-600 mt-1 text-right">{errors[`price_${item.id}`]}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <select
                        value={gstPct}
                        onChange={e => setItemGstRates(prev => ({ ...prev, [item.id]: Number(e.target.value) }))}
                        className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                      >
                        {GST_OPTIONS.map(g => <option key={g} value={g}>{g}%</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {Number(prices[item.id]) > 0
                        ? <span className="text-sm text-gray-500">₹{base.toFixed(2)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 mb-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-base text-gray-600">Total Cart Value (Pre-Tax)</span>
            <span className="text-base font-medium text-gray-700">₹{totalCartPreTax.toFixed(2)}</span>
          </div>
          {taxableAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-base text-gray-600">Taxable Amount</span>
              <span className="text-base text-gray-700">₹{taxableAmount.toFixed(2)}</span>
            </div>
          )}
          {nonTaxableAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-base text-gray-600">Non-Taxable Amount</span>
              <span className="text-base text-gray-700">₹{nonTaxableAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-base text-gray-600">Tax Amount</span>
            <span className="text-base text-gray-700">₹{taxAmount.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <span className="text-base font-semibold text-gray-700">Grand Total</span>
            <span className="text-xl font-bold text-gray-900">₹{grandTotal.toFixed(2)}</span>
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
          <label className="block text-base font-medium text-gray-700 mb-3">
            Payment Method <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-3">
            {[['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Credit Card']].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setPaymentMethod(val)}
                className={`text-sm px-4 py-2 rounded-full cursor-pointer font-medium transition-colors ${
                  paymentMethod === val
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {errors.paymentMethod && <p className="text-base text-red-600 mt-2">{errors.paymentMethod}</p>}
        </div>

        {errors.submit && (
          <p className="text-base text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            {errors.submit}
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold text-base py-4 rounded-xl min-h-[56px] transition-colors mb-8"
        >
          {submitting ? 'Logging Order…' : 'Log Order'}
        </button>
      </div>
    </div>
  )
}
