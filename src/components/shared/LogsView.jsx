import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import Navbar from './Navbar'
import StatusBadge from './StatusBadge'

const MEAL_LABELS = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
  snacks: 'Snacks', other: 'Other',
}
const ALL_TABS    = ['Requests', 'Orders', 'Supply', 'Storage', 'Receipts', 'Errors']
const PUBLIC_TABS = ALL_TABS.slice(0, 5)

function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const yy = String(dt.getFullYear()).slice(2)
  const hh = String(dt.getHours()).padStart(2, '0')
  const min = String(dt.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yy}, ${hh}:${min}`
}
function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const yy = String(dt.getFullYear()).slice(2)
  return `${dd}/${mm}/${yy}`
}
function inRange(dateStr, from, to) {
  const d = (dateStr ?? '').split('T')[0]
  if (from && d < from) return false
  if (to   && d > to)   return false
  return true
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function EmptyState({ emoji, message }) {
  return (
    <div className="text-center py-20">
      <p className="text-5xl mb-3">{emoji}</p>
      <p className="text-base text-gray-500">{message}</p>
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
            <h3 className="text-base font-bold text-gray-900">{title}</h3>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-500 text-xl leading-none">
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      </div>
    </>
  )
}

function FiltersPanel({ children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-5">
      <button
        onClick={() => setOpen(o => !o)}
        className="md:hidden flex items-center gap-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 px-3 py-2 rounded-lg mb-3"
      >
        Filters
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </button>
      <div className={`${open ? 'block' : 'hidden'} md:block`}>{children}</div>
    </div>
  )
}

function FRow({ children }) {
  return <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">{children}</div>
}
function FField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

const iCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const sCls = iCls + ' bg-white'

function THead({ cols }) {
  return (
    <thead>
      <tr className="bg-gray-50 border-b border-gray-200">
        {cols.map(h => (
          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
        ))}
      </tr>
    </thead>
  )
}

function PaymentPill({ method }) {
  if (!method) return null
  const m = (method ?? '').toLowerCase()
  let cls, label
  if (m === 'cash')                         { cls = 'bg-green-100 text-green-700';   label = 'Cash' }
  else if (m === 'upi')                     { cls = 'bg-blue-100 text-blue-700';     label = 'UPI'  }
  else if (m === 'card' || m === 'credit card') { cls = 'bg-purple-100 text-purple-700'; label = 'Card' }
  else                                      { cls = 'bg-gray-100 text-gray-600';     label = method }
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

// ── Tab 1 — Requests ──────────────────────────────────────────────────────────

function RequestsTab() {
  const [data, setData]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [expandedId, setExpanded] = useState(null)
  const [modal, setModal]         = useState(null)
  const [dateFrom, setFrom]       = useState('')
  const [dateTo, setTo]           = useState('')
  const [chefF, setChef]          = useState('')
  const [mealF, setMeal]          = useState('')
  const [statusF, setStatus]      = useState('')

  useEffect(() => {
    supabase
      .from('requests')
      .select('*, request_items(*, reviewer:profiles!acted_by(full_name)), chef:profiles!chef_id(full_name)')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data: rows }) => { setData(rows ?? []); setLoading(false) })
  }, [])

  const chefs = [...new Set(data.map(r => r.chef?.full_name).filter(Boolean))].sort()

  const displayed = data.filter(r =>
    inRange(r.created_at, dateFrom, dateTo) &&
    (!chefF   || r.chef?.full_name === chefF) &&
    (!mealF   || r.meal_purpose === mealF) &&
    (!statusF || r.status === statusF)
  )

  function ItemList({ req }) {
    const items = req.request_items ?? []
    if (!items.length) return <p className="text-sm text-gray-400">No items.</p>
    return (
      <div className="divide-y divide-gray-100">
        {items.map(i => (
          <div key={i.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {i.item_name}
                {i.is_custom && <span className="ml-1.5 text-xs text-blue-500">custom</span>}
              </p>
              <p className="text-xs text-gray-500">{i.quantity} {i.unit}</p>
              {i.rejection_note && <p className="text-xs text-red-600 italic mt-0.5">"{i.rejection_note}"</p>}
            </div>
            <StatusBadge status={i.item_status} />
          </div>
        ))}
      </div>
    )
  }

  if (loading) return <Spinner />

  return (
    <div>
      {modal && (
        <Modal
          title={`${MEAL_LABELS[modal.meal_purpose] ?? modal.meal_purpose} — ${modal.chef?.full_name ?? '—'}`}
          onClose={() => setModal(null)}
        >
          <ItemList req={modal} />
        </Modal>
      )}

      <FiltersPanel>
        <FRow>
          <FField label="From"><input type="date" value={dateFrom} onChange={e => setFrom(e.target.value)} className={iCls} /></FField>
          <FField label="To"><input type="date" value={dateTo} onChange={e => setTo(e.target.value)} className={iCls} /></FField>
          <FField label="Chef">
            <select value={chefF} onChange={e => setChef(e.target.value)} className={sCls}>
              <option value="">All chefs</option>
              {chefs.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FField>
          <FField label="Meal">
            <select value={mealF} onChange={e => setMeal(e.target.value)} className={sCls}>
              <option value="">All meals</option>
              {Object.entries(MEAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FField>
        </FRow>
        <FRow>
          <FField label="Status">
            <select value={statusF} onChange={e => setStatus(e.target.value)} className={sCls}>
              <option value="">All statuses</option>
              {['draft', 'submitted', 'under_review', 'closed', 'cancelled'].map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </FField>
        </FRow>
      </FiltersPanel>

      {data.length === 100 && (
        <p className="text-xs text-gray-400 text-center py-3 mb-2">
          Showing most recent 100 results. Use filters to narrow down.
        </p>
      )}
      {displayed.length === 0 ? (
        <EmptyState emoji="📋" message="No requests found." />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {displayed.map(req => {
              const items    = req.request_items ?? []
              const approved = items.filter(i => i.item_status === 'approved').length
              const rejected = items.filter(i => i.item_status === 'rejected').length
              const reviewer = items.find(i => i.reviewer?.full_name)?.reviewer?.full_name ?? '—'
              const open     = expandedId === req.id
              return (
                <div key={req.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div>
                      <p className="text-sm font-bold text-gray-900">{req.chef?.full_name ?? '—'}</p>
                      <p className="text-sm text-gray-600">{MEAL_LABELS[req.meal_purpose] ?? req.meal_purpose}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{fmt(req.created_at)}</p>
                    </div>
                    <StatusBadge status={req.status} />
                  </div>
                  <p className="text-xs text-gray-500 mb-1">
                    {items.length} items ·{' '}
                    <span className="text-green-600">{approved} approved</span> ·{' '}
                    <span className="text-red-600">{rejected} rejected</span>
                  </p>
                  <p className="text-xs text-gray-500 mb-2">Reviewed by: <span className="font-medium text-gray-700">{reviewer}</span></p>
                  <button onClick={() => setExpanded(open ? null : req.id)} className="text-sm text-blue-600 font-medium">
                    {open ? 'Hide ▲' : 'View Details ▼'}
                  </button>
                  {open && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <ItemList req={req} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <THead cols={['Date & Time', 'Chef', 'Meal', 'Status', 'Reviewed By', 'Items', '']} />
              <tbody className="divide-y divide-gray-100">
                {displayed.map(req => {
                  const items    = req.request_items ?? []
                  const approved = items.filter(i => i.item_status === 'approved').length
                  const rejected = items.filter(i => i.item_status === 'rejected').length
                  const reviewer = items.find(i => i.reviewer?.full_name)?.reviewer?.full_name ?? '—'
                  return (
                    <tr key={req.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(req.created_at)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{req.chef?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{MEAL_LABELS[req.meal_purpose] ?? req.meal_purpose}</td>
                      <td className="px-4 py-3"><StatusBadge status={req.status} /></td>
                      <td className="px-4 py-3 text-gray-700">{reviewer}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {items.length} · <span className="text-green-600">{approved}✓</span> · <span className="text-red-600">{rejected}✗</span>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setModal(req)} className="text-sm text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
                          View Details
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab 2 — Orders ────────────────────────────────────────────────────────────

function OrdersTab() {
  const [data, setData]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [expandedId, setExpanded] = useState(null)
  const [modal, setModal]         = useState(null)
  const [dateFrom, setFrom]       = useState('')
  const [dateTo, setTo]           = useState('')
  const [placedByF, setPlacedBy]  = useState('')
  const [vendorF, setVendor]      = useState('')

  useEffect(() => {
    supabase
      .from('orders')
      .select(`
        *,
        order_items(*),
        placed_by_profile:profiles!placed_by(full_name),
        request:requests!request_id(
          chef:profiles!chef_id(full_name)
        )
      `)
      .order('placed_at', { ascending: false })
      .limit(100)
      .then(({ data: rows }) => { setData(rows ?? []); setLoading(false) })
  }, [])

  const placedByList = [...new Set(data.map(o => o.placed_by_profile?.full_name).filter(Boolean))].sort()

  function calcOI(oi) {
    const base       = (Number(oi.price_per_unit) || 0) * (Number(oi.quantity_ordered) || 0)
    const rate       = (Number(oi.gst_percent) || 0) / 100
    const amountPaid = base * (1 + rate)
    return { base, amountPaid }
  }
  function grandTotal(order) {
    return (order.order_items ?? []).reduce((s, oi) => s + calcOI(oi).amountPaid, 0)
  }

  const displayed = data.filter(o =>
    (o.order_items?.length ?? 0) > 0 &&
    inRange(o.placed_at, dateFrom, dateTo) &&
    (!placedByF || o.placed_by_profile?.full_name === placedByF) &&
    (!vendorF   || (o.vendor_name ?? '').toLowerCase().includes(vendorF.toLowerCase()))
  )

  function OrderItems({ order }) {
    const rows     = (order.order_items ?? []).map(oi => ({ ...oi, ...calcOI(oi) }))
    const preTotal = rows.reduce((s, r) => s + r.base, 0)
    const taxable  = rows.filter(r => (Number(r.gst_percent) || 0) > 0).reduce((s, r) => s + r.base, 0)
    const nonTax   = rows.filter(r => (Number(r.gst_percent) || 0) === 0).reduce((s, r) => s + r.base, 0)
    const taxAmt   = rows.reduce((s, r) => s + (r.amountPaid - r.base), 0)
    const grand    = rows.reduce((s, r) => s + r.amountPaid, 0)
    return (
      <div>
        {order.payment_method && (
          <p className="text-sm text-gray-500 mb-3">
            Paid via: <PaymentPill method={order.payment_method} />
          </p>
        )}

        {/* Desktop item table */}
        <div className="hidden md:block overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Item Name', 'Qty', 'Unit', 'GST%', 'Amount Paid (₹)', 'Base (₹)'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(oi => {
                const gst = Number(oi.gst_percent) || 0
                return (
                  <tr key={oi.id}>
                    <td className="px-3 py-2.5 font-medium text-gray-900">
                      <div className="flex items-center gap-2 flex-wrap">
                        {oi.item_name}
                        {gst > 0
                          ? <span className="bg-gray-100 text-gray-600 text-xs rounded-full px-2 py-0.5">{gst}% GST</span>
                          : <span className="bg-orange-100 text-orange-600 text-xs rounded-full px-2 py-0.5">No Tax</span>
                        }
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{oi.quantity_ordered}</td>
                    <td className="px-3 py-2.5 text-gray-600">{oi.unit}</td>
                    <td className="px-3 py-2.5 text-gray-600">{gst}%</td>
                    <td className="px-3 py-2.5 text-gray-900 whitespace-nowrap">₹{oi.amountPaid.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">₹{oi.base.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile item list */}
        <div className="md:hidden divide-y divide-gray-100 mb-4">
          {rows.map(oi => {
            const gst = Number(oi.gst_percent) || 0
            return (
              <div key={oi.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900">{oi.item_name}</p>
                    {gst > 0
                      ? <span className="bg-gray-100 text-gray-600 text-xs rounded-full px-2 py-0.5">{gst}% GST</span>
                      : <span className="bg-orange-100 text-orange-600 text-xs rounded-full px-2 py-0.5">No Tax</span>
                    }
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{oi.quantity_ordered} {oi.unit} · Base ₹{oi.base.toFixed(2)}</p>
                </div>
                <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">₹{oi.amountPaid.toFixed(2)}</p>
              </div>
            )
          })}
        </div>

        <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Total Cart Value (Pre-Tax)</span><span>₹{preTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Taxable Amount</span><span>₹{taxable.toFixed(2)}</span>
          </div>
          {nonTax > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Non-Taxable Amount</span><span>₹{nonTax.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-600">
            <span>Tax Amount</span><span>₹{taxAmt.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200">
            <span>Grand Total</span><span>₹{grand.toFixed(2)}</span>
          </div>
        </div>
      </div>
    )
  }

  if (loading) return <Spinner />

  return (
    <div>
      {modal && (
        <Modal title={`Order — ${modal.vendor_name}`} onClose={() => setModal(null)}>
          <OrderItems order={modal} />
        </Modal>
      )}

      <FiltersPanel>
        <FRow>
          <FField label="From"><input type="date" value={dateFrom} onChange={e => setFrom(e.target.value)} className={iCls} /></FField>
          <FField label="To"><input type="date" value={dateTo} onChange={e => setTo(e.target.value)} className={iCls} /></FField>
          <FField label="Placed By">
            <select value={placedByF} onChange={e => setPlacedBy(e.target.value)} className={sCls}>
              <option value="">All</option>
              {placedByList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </FField>
          <FField label="Vendor">
            <input type="text" value={vendorF} onChange={e => setVendor(e.target.value)} placeholder="Search vendor…" className={iCls} />
          </FField>
        </FRow>
      </FiltersPanel>

      {data.length === 100 && (
        <p className="text-xs text-gray-400 text-center py-3 mb-2">
          Showing most recent 100 results. Use filters to narrow down.
        </p>
      )}
      {displayed.length === 0 ? (
        <EmptyState emoji="📦" message="No orders found." />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {displayed.map(order => {
              const grand = grandTotal(order)
              const open  = expandedId === order.id
              return (
                <div key={order.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-gray-900">{order.vendor_name}</p>
                        <PaymentPill method={order.payment_method} />
                      </div>
                      <p className="text-sm text-gray-600">{order.placed_by_profile?.full_name ?? '—'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{fmt(order.placed_at)}</p>
                    </div>
                    <p className="text-sm font-bold text-gray-900">₹{grand.toFixed(2)}</p>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">
                    Chef: {order.request?.chef?.full_name ?? '—'} · {order.order_items?.length ?? 0} items
                  </p>
                  <button onClick={() => setExpanded(open ? null : order.id)} className="text-sm text-blue-600 font-medium">
                    {open ? 'Hide ▲' : 'View Details ▼'}
                  </button>
                  {open && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <OrderItems order={order} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <THead cols={['Date & Time', 'Placed By', 'Chef', 'Vendor', 'Items', 'Grand Total', '']} />
              <tbody className="divide-y divide-gray-100">
                {displayed.map(order => {
                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(order.placed_at)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{order.placed_by_profile?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{order.request?.chef?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">
                        <div className="flex items-center gap-2 flex-wrap">
                          {order.vendor_name}
                          <PaymentPill method={order.payment_method} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{order.order_items?.length ?? 0}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">₹{grandTotal(order).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => setModal(order)} className="text-sm text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
                          View Details
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab 3 — Supply ────────────────────────────────────────────────────────────

function SupplyTab() {
  const [data, setData]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [dateFrom, setFrom]     = useState('')
  const [dateTo, setTo]         = useState('')
  const [suppliedByF, setSupBy] = useState('')
  const [chefF, setChef]        = useState('')
  const [itemSearch, setSearch] = useState('')

  useEffect(() => {
    supabase
      .from('supply_logs')
      .select(`
        *,
        order_item:order_items!order_item_id(
          item_name, quantity_ordered, unit,
          request_item:request_items!request_item_id(quantity),
          order:orders!order_id(
            request:requests!request_id(
              chef:profiles!chef_id(full_name)
            )
          )
        ),
        supplied_by_profile:profiles!supplied_by(full_name)
      `)
      .order('supplied_at', { ascending: false })
      .limit(100)
      .then(({ data: rows }) => { setData(rows ?? []); setLoading(false) })
  }, [])

  const suppliers = [...new Set(data.map(s => s.supplied_by_profile?.full_name).filter(Boolean))].sort()
  const chefs     = [...new Set(data.map(s => s.order_item?.order?.request?.chef?.full_name).filter(Boolean))].sort()

  const displayed = data.filter(s => {
    const oi   = s.order_item ?? {}
    const chef = oi.order?.request?.chef?.full_name ?? ''
    return (
      inRange(s.supplied_at, dateFrom, dateTo) &&
      (!suppliedByF || s.supplied_by_profile?.full_name === suppliedByF) &&
      (!chefF       || chef === chefF) &&
      (!itemSearch  || (oi.item_name ?? '').toLowerCase().includes(itemSearch.toLowerCase()))
    )
  })

  function Diff({ supplied, requested, unit }) {
    if (requested == null) return <span className="text-gray-400">—</span>
    const d = Math.round((Number(supplied) - Number(requested)) * 10) / 10
    const u = unit ?? ''
    if (d === 0) return <span className="text-green-600 font-medium">✓</span>
    if (d < 0)   return <span className="text-red-600 font-medium">{d}{u}</span>
    return <span className="text-amber-600 font-medium">+{d}{u}</span>
  }

  if (loading) return <Spinner />

  return (
    <div>
      <FiltersPanel>
        <FRow>
          <FField label="From"><input type="date" value={dateFrom} onChange={e => setFrom(e.target.value)} className={iCls} /></FField>
          <FField label="To"><input type="date" value={dateTo} onChange={e => setTo(e.target.value)} className={iCls} /></FField>
          <FField label="Supplied By">
            <select value={suppliedByF} onChange={e => setSupBy(e.target.value)} className={sCls}>
              <option value="">All</option>
              {suppliers.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </FField>
          <FField label="Chef">
            <select value={chefF} onChange={e => setChef(e.target.value)} className={sCls}>
              <option value="">All chefs</option>
              {chefs.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FField>
        </FRow>
        <FRow>
          <FField label="Item name">
            <input type="text" value={itemSearch} onChange={e => setSearch(e.target.value)} placeholder="Search item…" className={iCls} />
          </FField>
        </FRow>
      </FiltersPanel>

      {data.length === 100 && (
        <p className="text-xs text-gray-400 text-center py-3 mb-2">
          Showing most recent 100 results. Use filters to narrow down.
        </p>
      )}
      {displayed.length === 0 ? (
        <EmptyState emoji="🚚" message="No supply logs found." />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {displayed.map(s => {
              const oi         = s.order_item ?? {}
              const reqQty     = oi.request_item?.quantity
              const chef       = oi.order?.request?.chef?.full_name ?? '—'
              const suppliedBy = s.supplied_by_profile?.full_name ?? '—'
              return (
                <div key={s.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900">{oi.item_name ?? '—'}</p>
                    <p className="text-xs text-gray-400 whitespace-nowrap">{fmt(s.supplied_at)}</p>
                  </div>
                  <p className="text-sm text-gray-600">By {suppliedBy} · Chef: {chef}</p>
                  <div className="flex gap-4 text-sm text-gray-600 flex-wrap">
                    <span>Requested: {reqQty != null ? `${reqQty}${oi.unit ?? ''}` : '—'}</span>
                    <span>Ordered: {oi.quantity_ordered != null ? `${oi.quantity_ordered}${oi.unit ?? ''}` : '—'}</span>
                    <span>Supplied: {s.quantity_supplied}{s.unit}</span>
                  </div>
                  <p className="text-sm">Diff: <Diff supplied={s.quantity_supplied} requested={reqQty} unit={s.unit} /></p>
                  {s.difference_reason && (
                    <p className="text-xs text-gray-500 italic">"{s.difference_reason}"</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <THead cols={['Date & Time', 'Supplied By', 'Chef', 'Item', 'Requested', 'Ordered', 'Supplied', 'Diff', 'Reason']} />
              <tbody className="divide-y divide-gray-100">
                {displayed.map(s => {
                  const oi         = s.order_item ?? {}
                  const reqQty     = oi.request_item?.quantity
                  const chef       = oi.order?.request?.chef?.full_name ?? '—'
                  const suppliedBy = s.supplied_by_profile?.full_name ?? '—'
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(s.supplied_at)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{suppliedBy}</td>
                      <td className="px-4 py-3 text-gray-700">{chef}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{oi.item_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{reqQty != null ? `${reqQty}${oi.unit ?? ''}` : '—'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{oi.quantity_ordered != null ? `${oi.quantity_ordered}${oi.unit ?? ''}` : '—'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{s.quantity_supplied}{s.unit}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><Diff supplied={s.quantity_supplied} requested={reqQty} unit={s.unit} /></td>
                      <td className="px-4 py-3 text-gray-500 italic text-xs max-w-xs truncate">{s.difference_reason ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab 4 — Storage ───────────────────────────────────────────────────────────

function StorageBadge({ available }) {
  return available
    ? <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">In Storage</span>
    : <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">Consumed</span>
}

function StorageTab() {
  const { profile }             = useAuth()
  const [data, setData]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [statusF, setStatus]    = useState('available')
  const [dateFrom, setFrom]     = useState('')
  const [dateTo, setTo]         = useState('')
  const [itemSearch, setSearch] = useState('')

  // Use-item modal state
  const [selected, setSelected]   = useState(null) // storage row being used
  const [useQty, setUseQty]       = useState('')
  const [useNotes, setUseNotes]   = useState('')
  const [useErr, setUseErr]       = useState('')
  const [submitting, setSub]      = useState(false)

  useEffect(() => {
    const fetchData = () =>
      supabase
        .from('storage_log')
        .select(`
          *,
          order_item:order_items!order_item_id(
            order:orders!order_id(
              request:requests!request_id(
                chef:profiles!chef_id(full_name)
              )
            )
          )
        `)
        .order('date_stored', { ascending: false })
        .limit(100)
        .then(({ data: rows }) => { setData(rows ?? []); setLoading(false) })

    fetchData()

    const channel = supabase
      .channel('storage_log_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'storage_log' }, fetchData)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const openUse = (s) => {
    setSelected(s)
    setUseQty(String(s.quantity_in_storage))
    setUseNotes('')
    setUseErr('')
  }

  const handleUse = async () => {
    const qty     = Number(useQty)
    const maxQty  = Number(selected.quantity_in_storage)
    if (!useQty || qty <= 0)   { setUseErr('Enter a quantity greater than 0.'); return }
    if (qty > maxQty)          { setUseErr(`Cannot exceed available quantity (${maxQty} ${selected.unit}).`); return }
    setSub(true)
    setUseErr('')
    try {
      const { error: slErr } = await supabase.from('supply_logs').insert({
        order_item_id:     selected.order_item_id,
        supplied_by:       profile.id,
        supplied_at:       new Date().toISOString(),
        quantity_supplied: qty,
        unit:              selected.unit,
        difference_reason: useNotes.trim() || null,
      })
      if (slErr) throw slErr

      if (qty >= maxQty) {
        await supabase.from('storage_log').update({ is_available: false }).eq('id', selected.id)
      } else {
        await supabase.from('storage_log').update({ quantity_in_storage: maxQty - qty }).eq('id', selected.id)
      }

      setSelected(null)
    } catch (err) {
      setUseErr(err.message)
      setSub(false)
    }
  }

  const displayed = data.filter(s =>
    (statusF === 'all' || s.is_available) &&
    inRange(s.date_stored, dateFrom, dateTo) &&
    (!itemSearch || (s.item_name ?? '').toLowerCase().includes(itemSearch.toLowerCase()))
  )

  if (loading) return <Spinner />

  return (
    <div>
      {/* Use Item modal */}
      {selected && (
        <Modal title={`Use — ${selected.item_name}`} onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-600 space-y-1">
              <div className="flex justify-between">
                <span>Available in storage</span>
                <span className="font-semibold text-gray-900">{selected.quantity_in_storage} {selected.unit}</span>
              </div>
              <div className="flex justify-between">
                <span>Stored on</span>
                <span className="text-gray-700">{fmtDate(selected.date_stored)}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Quantity to use <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  onWheel={e => e.target.blur()}
                  value={useQty}
                  onChange={e => setUseQty(e.target.value)}
                  className={`w-32 border rounded-lg px-3 py-2.5 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    useErr && (Number(useQty) <= 0 || Number(useQty) > Number(selected.quantity_in_storage))
                      ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  }`}
                />
                <span className="text-sm text-gray-500">{selected.unit}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Notes <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={useNotes}
                onChange={e => setUseNotes(e.target.value)}
                placeholder="e.g. used for staff lunch"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {useErr && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{useErr}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setSelected(null)}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUse}
                disabled={submitting}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                {submitting ? 'Saving…' : 'Confirm Use'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <FiltersPanel>
        <div className="flex bg-gray-100 p-1 rounded-xl mb-4 md:hidden">
          {[['available', 'In Storage'], ['all', 'All']].map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${statusF === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {l}
            </button>
          ))}
        </div>
        <FRow>
          <FField label="From"><input type="date" value={dateFrom} onChange={e => setFrom(e.target.value)} className={iCls} /></FField>
          <FField label="To"><input type="date" value={dateTo} onChange={e => setTo(e.target.value)} className={iCls} /></FField>
          <FField label="Item name">
            <input type="text" value={itemSearch} onChange={e => setSearch(e.target.value)} placeholder="Search item…" className={iCls} />
          </FField>
          <FField label="Status">
            <select value={statusF} onChange={e => setStatus(e.target.value)} className={sCls + ' hidden md:block'}>
              <option value="available">In Storage</option>
              <option value="all">All</option>
            </select>
          </FField>
        </FRow>
      </FiltersPanel>

      <div className="flex items-center gap-2 mb-4">
        <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          Live
        </span>
      </div>

      {data.length === 100 && (
        <p className="text-xs text-gray-400 text-center py-3 mb-2">
          Showing most recent 100 results. Use filters to narrow down.
        </p>
      )}
      {displayed.length === 0 ? (
        <EmptyState emoji="🗄️" message="Nothing in storage." />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {displayed.map(s => {
              const chef = s.order_item?.order?.request?.chef?.full_name ?? '—'
              return (
                <div key={s.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900">{s.item_name}</p>
                    <StorageBadge available={s.is_available} />
                  </div>
                  <p className="text-sm text-gray-600">{s.quantity_in_storage} {s.unit} · Chef: {chef}</p>
                  <p className="text-xs text-gray-400">{fmtDate(s.date_stored)}</p>
                  {s.notes && <p className="text-xs text-gray-500 italic">"{s.notes}"</p>}
                  {s.is_available && (
                    <button
                      onClick={() => openUse(s)}
                      className="mt-1 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Use Item →
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <THead cols={['Date Stored', 'Item', 'Qty Available', 'Status', 'Chef', 'Notes', '']} />
              <tbody className="divide-y divide-gray-100">
                {displayed.map(s => {
                  const chef = s.order_item?.order?.request?.chef?.full_name ?? '—'
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(s.date_stored)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{s.item_name}</td>
                      <td className="px-4 py-3 text-gray-700">{s.quantity_in_storage} {s.unit}</td>
                      <td className="px-4 py-3"><StorageBadge available={s.is_available} /></td>
                      <td className="px-4 py-3 text-gray-700">{chef}</td>
                      <td className="px-4 py-3 text-gray-500 italic text-xs max-w-xs truncate">{s.notes ?? ''}</td>
                      <td className="px-4 py-3">
                        {s.is_available && (
                          <button
                            onClick={() => openUse(s)}
                            className="text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                          >
                            Use Item →
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab 5 — Receipts ──────────────────────────────────────────────────────────

function ReceiptsTab() {
  const [data, setData]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [dateFrom, setFrom]       = useState('')
  const [dateTo, setTo]           = useState('')
  const [chefF, setChef]          = useState('')
  const [itemSearch, setSearch]   = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const { data: receipts, error: recErr } = await supabase
          .from('receipt_confirmations')
          .select('*')
          .order('confirmed_at', { ascending: false })
          .limit(100)
        if (recErr) throw recErr
        if (!receipts?.length) { setData([]); setLoading(false); return }

        const supplyLogIds = receipts.map(r => r.supply_log_id)
        const { data: supplyLogs, error: slErr } = await supabase
          .from('supply_logs').select('*').in('id', supplyLogIds)
        if (slErr) throw slErr

        const orderItemIds = (supplyLogs ?? []).map(s => s.order_item_id)
        const { data: orderItems, error: oiErr } = await supabase
          .from('order_items').select('*').in('id', orderItemIds)
        if (oiErr) throw oiErr

        const orderIds = [...new Set((orderItems ?? []).map(oi => oi.order_id))]
        const { data: orders, error: ordErr } = await supabase
          .from('orders').select('*').in('id', orderIds)
        if (ordErr) throw ordErr

        const requestIds = [...new Set((orders ?? []).map(o => o.request_id))]
        const { data: requests, error: reqErr } = await supabase
          .from('requests').select('*').in('id', requestIds)
        if (reqErr) throw reqErr

        const profileIds = [...new Set([
          ...receipts.map(r => r.confirmed_by),
          ...(requests ?? []).map(r => r.chef_id),
        ].filter(Boolean))]
        const { data: profiles, error: profErr } = await supabase
          .from('profiles').select('id, full_name').in('id', profileIds)
        if (profErr) throw profErr
        const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.full_name]))

        const assembled = receipts.map(receipt => {
          const supplyLog = (supplyLogs ?? []).find(s => s.id === receipt.supply_log_id)
          const orderItem = (orderItems ?? []).find(oi => oi.id === supplyLog?.order_item_id)
          const order     = (orders ?? []).find(o => o.id === orderItem?.order_id)
          const request   = (requests ?? []).find(r => r.id === order?.request_id)
          return {
            id:                receipt.id,
            confirmed_at:      receipt.confirmed_at,
            confirmed_by_name: profileMap[receipt.confirmed_by] ?? 'Unknown',
            quantity_received: receipt.quantity_received,
            discrepancy_note:  receipt.discrepancy_note,
            quantity_supplied: supplyLog?.quantity_supplied ?? null,
            unit:              supplyLog?.unit ?? '',
            difference_reason: supplyLog?.difference_reason ?? null,
            item_name:         orderItem?.item_name ?? '—',
            chef_name:         profileMap[request?.chef_id] ?? 'Unknown',
            meal_purpose:      request?.meal_purpose ?? null,
          }
        })

        setData(assembled)
        setLoading(false)
      } catch {
        setLoadError('Something went wrong. Please refresh and try again.')
        setLoading(false)
      }
    }
    load()
  }, [])

  const chefs = [...new Set(data.map(r => r.chef_name).filter(Boolean))].sort()

  const displayed = data.filter(r =>
    inRange(r.confirmed_at, dateFrom, dateTo) &&
    (!chefF      || r.chef_name === chefF) &&
    (!itemSearch || r.item_name.toLowerCase().includes(itemSearch.toLowerCase()))
  )

  if (loading) return <Spinner />
  if (loadError) return <p className="text-red-600 text-sm text-center py-4">{loadError}</p>

  return (
    <div>
      <FiltersPanel>
        <FRow>
          <FField label="From"><input type="date" value={dateFrom} onChange={e => setFrom(e.target.value)} className={iCls} /></FField>
          <FField label="To"><input type="date" value={dateTo} onChange={e => setTo(e.target.value)} className={iCls} /></FField>
          <FField label="Chef">
            <select value={chefF} onChange={e => setChef(e.target.value)} className={sCls}>
              <option value="">All chefs</option>
              {chefs.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FField>
          <FField label="Item name">
            <input type="text" value={itemSearch} onChange={e => setSearch(e.target.value)} placeholder="Search item…" className={iCls} />
          </FField>
        </FRow>
      </FiltersPanel>

      {data.length === 100 && (
        <p className="text-xs text-gray-400 text-center py-3 mb-2">
          Showing most recent 100 results. Use filters to narrow down.
        </p>
      )}
      {displayed.length === 0 ? (
        <EmptyState emoji="✅" message="No receipts found." />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {displayed.map(r => {
              const discrepancy = Number(r.quantity_received) - Number(r.quantity_supplied)
              return (
                <div key={r.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900">{r.item_name}</p>
                    <p className="text-xs text-gray-400 whitespace-nowrap">{fmt(r.confirmed_at)}</p>
                  </div>
                  <p className="text-sm text-gray-600">By {r.confirmed_by_name} · Chef: {r.chef_name}</p>
                  <div className="flex gap-4 text-sm text-gray-600 flex-wrap">
                    <span>Supplied: {r.quantity_supplied} {r.unit}</span>
                    <span>Received: {r.quantity_received} {r.unit}</span>
                  </div>
                  {discrepancy !== 0 && (
                    <p className="text-sm text-red-600 font-medium">
                      Discrepancy: {discrepancy > 0 ? '+' : ''}{Math.round(discrepancy * 10) / 10}{r.unit}
                    </p>
                  )}
                  {r.discrepancy_note && <p className="text-xs text-gray-500 italic">"{r.discrepancy_note}"</p>}
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <THead cols={['Date & Time', 'Confirmed By', 'Chef', 'Item', 'Supplied', 'Received', 'Discrepancy', 'Note']} />
              <tbody className="divide-y divide-gray-100">
                {displayed.map(r => {
                  const discrepancy = Number(r.quantity_received) - Number(r.quantity_supplied)
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(r.confirmed_at)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{r.confirmed_by_name}</td>
                      <td className="px-4 py-3 text-gray-700">{r.chef_name}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{r.item_name}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.quantity_supplied} {r.unit}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.quantity_received} {r.unit}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {discrepancy === 0
                          ? <span className="text-green-600 font-medium">—</span>
                          : <span className="text-red-600 font-medium">{discrepancy > 0 ? '+' : ''}{Math.round(discrepancy * 10) / 10}{r.unit}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 italic text-xs max-w-xs truncate">{r.discrepancy_note ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab 6 — Errors (admin only) ───────────────────────────────────────────────

function ErrorsTab() {
  const [appErrors, setAppErrors]     = useState([])
  const [orphanOrders, setOrphans]    = useState([])
  const [loading, setLoading]         = useState(true)
  const [deleting, setDeleting]       = useState(null)

  const fetchAll = async () => {
    const [{ data: errs }, { data: orders }] = await Promise.all([
      supabase
        .from('app_errors')
        .select('*, user:profiles!user_id(full_name)')
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('id, vendor_name, placed_at, placed_by_profile:profiles!placed_by(full_name), order_items(id)')
        .order('placed_at', { ascending: false }),
    ])
    setAppErrors(errs ?? [])
    setOrphans((orders ?? []).filter(o => (o.order_items?.length ?? 0) === 0))
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const deleteError = async (id) => {
    setDeleting(id)
    await supabase.from('app_errors').delete().eq('id', id)
    setAppErrors(prev => prev.filter(e => e.id !== id))
    setDeleting(null)
  }

  const deleteOrphan = async (id) => {
    setDeleting(id)
    await supabase.from('orders').delete().eq('id', id)
    setOrphans(prev => prev.filter(o => o.id !== id))
    setDeleting(null)
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-8">

      {/* ── App Errors ── */}
      <section>
        <h2 className="text-base font-bold text-gray-800 mb-3">
          App Errors <span className="text-gray-400 font-normal text-sm">({appErrors.length})</span>
        </h2>
        {appErrors.length === 0 ? (
          <EmptyState emoji="✅" message="No app errors logged." />
        ) : (
          <div className="space-y-3">
            {appErrors.map(e => {
              const ctx = e.context ?? {}
              return (
                <div key={e.id} className="bg-white rounded-xl border border-red-200 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                          {e.component ?? 'Unknown'}
                        </span>
                        <span className="text-xs text-gray-400">{fmt(e.created_at)}</span>
                      </div>
                      <p className="text-xs text-gray-500">by {e.user?.full_name ?? 'unknown user'}</p>
                    </div>
                    <button
                      onClick={() => deleteError(e.id)}
                      disabled={deleting === e.id}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                    >
                      {deleting === e.id ? 'Deleting…' : 'Dismiss'}
                    </button>
                  </div>

                  <p className="text-sm font-medium text-red-800 mb-2 break-words">{e.message}</p>

                  {Object.keys(ctx).length > 0 && (
                    <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                      {Object.entries(ctx).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-xs">
                          <span className="text-gray-400 font-mono shrink-0">{k}:</span>
                          <span className="text-gray-700 font-mono break-all">{String(v ?? '—')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Orphaned Orders ── */}
      <section>
        <h2 className="text-base font-bold text-gray-800 mb-1">
          Orphaned Orders <span className="text-gray-400 font-normal text-sm">({orphanOrders.length})</span>
        </h2>
        <p className="text-xs text-gray-500 mb-3">Orders created but no items were attached — typically from a failed placement before the auto-rollback fix.</p>
        {orphanOrders.length === 0 ? (
          <div className="text-sm text-gray-400 py-4">None found.</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <THead cols={['Date', 'Placed By', 'Vendor', 'Order ID', '']} />
              <tbody className="divide-y divide-gray-100">
                {orphanOrders.map(o => (
                  <tr key={o.id} className="hover:bg-red-50">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(o.placed_at)}</td>
                    <td className="px-4 py-3 text-gray-900">{o.placed_by_profile?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{o.vendor_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{o.id}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteOrphan(o.id)}
                        disabled={deleting === o.id}
                        className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {deleting === o.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LogsView() {
  const { profile, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState(0)

  const isAdmin = profile?.role === 'admin'
  const TABS    = isAdmin ? ALL_TABS : PUBLIC_TABS

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />

      {/* Tab bar — sticky below navbar */}
      <div className="bg-white border-b border-gray-200 sticky top-14 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex overflow-x-auto -mb-px">
            {TABS.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                className={`flex-shrink-0 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === i
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                } ${tab === 'Errors' ? 'text-red-500 hover:text-red-700' : ''}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6">
        {activeTab === 0 && <RequestsTab />}
        {activeTab === 1 && <OrdersTab />}
        {activeTab === 2 && <SupplyTab />}
        {activeTab === 3 && <StorageTab />}
        {activeTab === 4 && <ReceiptsTab />}
        {activeTab === 5 && isAdmin && <ErrorsTab />}
      </div>
    </div>
  )
}
