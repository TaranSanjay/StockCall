import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import StatusBadge from '../shared/StatusBadge'
import Toast from '../shared/Toast'

const MEAL_LABELS = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
  snacks: 'Snacks', other: 'Other',
}

function DeptTag({ department }) {
  return department === 'housekeeping'
    ? <span className="bg-teal-100 text-teal-700 text-xs rounded-full px-2 py-0.5">🧹 Housekeeping</span>
    : <span className="bg-orange-100 text-orange-700 text-xs rounded-full px-2 py-0.5">🍳 Kitchen</span>
}

function fmt(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yy}, ${hh}:${min}`
}

// ── Check which of the chef's own closed requests still need receipt ──────────
// Uses the same per-request query pattern as ConfirmReceipt.jsx (known to work).
async function computeReceiptIds(requests, myId) {
  const myClosed = requests.filter(r => r.chef_id === myId && r.status === 'closed')
  console.log('[receipt check] starting for', myClosed?.length, 'requests')
  if (!myClosed.length) return new Set()

  const needsReceiptSet = new Set()

  for (const req of myClosed) {
    const { data: orders, error: ordersErr } = await supabase
      .from('orders').select('id').eq('request_id', req.id)
    console.log('[receipt check] orders:', orders, ordersErr)
    if (!orders?.length) continue

    const { data: orderItems, error: oiErr } = await supabase
      .from('order_items').select('id')
      .in('order_id', orders.map(o => o.id))
    console.log('[receipt check] orderItems:', orderItems, oiErr)
    if (!orderItems?.length) continue

    const { data: supplyLogs, error: slErr } = await supabase
      .from('supply_logs').select('id')
      .in('order_item_id', orderItems.map(oi => oi.id))
    console.log('[receipt check] supplyLogs:', supplyLogs, slErr)
    if (!supplyLogs?.length) continue

    const { data: receipts, error: rcErr } = await supabase
      .from('receipt_confirmations').select('supply_log_id')
      .in('supply_log_id', supplyLogs.map(sl => sl.id))
    console.log('[receipt check] receipts:', receipts, rcErr)

    const confirmedIds = new Set((receipts ?? []).map(r => r.supply_log_id))
    if (supplyLogs.some(sl => !confirmedIds.has(sl.id))) {
      needsReceiptSet.add(req.id)
    }
  }

  console.log('[receipt check] needsReceiptSet:', [...needsReceiptSet])
  return needsReceiptSet
}

// ── Detail slide-over ─────────────────────────────────────────────────────────
function DetailPanel({ request, isOwner, needsReceipt, cancelling, onClose, onEdit, onCancel, onConfirmReceipt, supplyMap = {} }) {
  const items     = request.request_items ?? []
  const isDraft   = request.status === 'draft'
  const canCancel = request.status === 'draft' || request.status === 'submitted'

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col md:inset-auto md:right-0 md:top-0 md:bottom-0 md:w-[420px] md:rounded-none md:border-l md:border-gray-200">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="space-y-1.5 min-w-0 pr-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-lg font-bold text-gray-900">
                {request.department === 'housekeeping'
                  ? 'Housekeeping Request'
                  : (MEAL_LABELS[request.meal_purpose] ?? request.meal_purpose)}
              </p>
              <DeptTag department={request.department} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={request.status} />
              <span className="text-sm text-gray-500">
                {request.chef?.full_name ?? 'Unknown chef'}
                {isOwner && <span className="ml-1 text-blue-500 font-medium">(you)</span>}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Items ({items.length})</p>
            <div className="divide-y divide-gray-100">
              {items.map(item => (
                <div key={item.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-base text-gray-900">
                      {item.item_name}
                      {item.is_custom && <span className="ml-1.5 text-xs text-blue-500 font-medium">custom</span>}
                    </p>
                    <p className="text-sm text-gray-500">{item.quantity} {item.unit}</p>
                    {item.item_status === 'approved' && supplyMap[item.id] && (
                      <p className="text-sm text-gray-500">Supplied: {supplyMap[item.id].qty} {supplyMap[item.id].unit}</p>
                    )}
                    {item.rejection_note && (
                      <p className="text-sm text-red-600 mt-0.5 italic">"{item.rejection_note}"</p>
                    )}
                  </div>
                  {request.status !== 'draft' && request.status !== 'submitted' && (
                    <StatusBadge status={item.item_status} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {request.notes && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-base text-gray-700">{request.notes}</p>
            </div>
          )}

          <div className="text-sm text-gray-400 space-y-0.5">
            <p>Created: {fmt(request.created_at)}</p>
            {request.submitted_at && <p>Sent: {fmt(request.submitted_at)}</p>}
          </div>
        </div>

        {/* Actions — only for owner */}
        {isOwner && (isDraft || canCancel || needsReceipt) && (
          <div className="px-5 py-4 border-t border-gray-200 flex-shrink-0 space-y-2.5">
            {isDraft && (
              <button onClick={onEdit}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base py-3 rounded-xl transition-colors min-h-[48px]">
                Edit Draft
              </button>
            )}
            {needsReceipt && (
              <button onClick={onConfirmReceipt}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold text-base py-3 rounded-xl transition-colors min-h-[48px]">
                Mark as Done
              </button>
            )}
            {canCancel && (
              <button onClick={onCancel} disabled={cancelling}
                className="w-full border border-red-200 text-red-600 hover:bg-red-50 font-semibold text-base py-3 rounded-xl transition-colors min-h-[48px] disabled:opacity-50">
                {cancelling ? 'Cancelling…' : 'Cancel Request'}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AllRequests() {
  const { profile }   = useAuth()
  const navigate      = useNavigate()
  const location      = useLocation()

  const [requests, setRequests]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [loadError, setLoadError]         = useState(null)
  const [filter, setFilter]               = useState('all')   // 'all' | 'mine'
  const [mealFilter, setMealFilter]       = useState('')
  const [selected, setSelected]           = useState(null)
  const [supplyMap, setSupplyMap]         = useState({})
  const [cancelling, setCancelling]       = useState(false)
  const [needsReceiptIds, setNeedsReceiptIds]   = useState(new Set())
  const [orderedRequestIds, setOrderedRequestIds] = useState(new Set())
  const [toast, setToast]                 = useState(
    location.state?.toast ? { message: location.state.toast, type: 'success' } : null
  )

  useEffect(() => {
    if (location.state?.toast) window.history.replaceState({}, '')
  }, [location.state?.toast])

  const fetchRequests = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    setLoadError(null)

    try {
      // Scope query by role:
      // - housekeeper: only their own requests
      // - chef: only kitchen requests (department = 'kitchen' or unset)
      let query = supabase
        .from('requests')
        .select('*, request_items(*)')
        .order('created_at', { ascending: false })
        .limit(100)

      if (profile.role === 'housekeeper') {
        query = query.eq('chef_id', profile.id)
      }

      const { data: reqs, error: reqErr } = await query
      if (reqErr) throw reqErr

      const roleFiltered = (reqs ?? []).filter(r =>
        profile.role !== 'chef' || (r.department ?? 'kitchen') !== 'housekeeping'
      )

      if (!roleFiltered.length) { setRequests([]); setLoading(false); return }

      // Fetch chef names (separate query avoids FK ambiguity)
      const chefIds = [...new Set(roleFiltered.map(r => r.chef_id))]
      const { data: chefProfiles, error: profErr } = await supabase
        .from('profiles').select('id, full_name, username').in('id', chefIds)
      if (profErr) throw profErr

      const pMap = Object.fromEntries((chefProfiles ?? []).map(p => [p.id, p]))
      const enriched = roleFiltered.map(r => ({ ...r, chef: pMap[r.chef_id] ?? null }))

      setRequests(enriched)

      // Fetch which closed requests have an order placed
      const closedIds = enriched.filter(r => r.status === 'closed').map(r => r.id)
      if (closedIds.length) {
        const { data: orders, error: ordErr } = await supabase
          .from('orders').select('request_id').in('request_id', closedIds)
        if (ordErr) throw ordErr
        setOrderedRequestIds(new Set((orders ?? []).map(o => o.request_id)))
      } else {
        setOrderedRequestIds(new Set())
      }

      // Batch check receipt status for own closed requests
      const receiptIds = await computeReceiptIds(enriched, profile.id)
      setNeedsReceiptIds(receiptIds)

      setLoading(false)
    } catch {
      setLoadError('Something went wrong. Please refresh and try again.')
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  useEffect(() => {
    if (!selected || selected.status !== 'closed') { setSupplyMap({}); return }
    async function fetchSupply() {
      const { data: orders } = await supabase
        .from('orders').select('id').eq('request_id', selected.id)
      if (!orders?.length) return
      const { data: orderItems } = await supabase
        .from('order_items').select('id').in('order_id', orders.map(o => o.id))
      if (!orderItems?.length) return
      const { data: supplyData } = await supabase
        .from('supply_logs')
        .select('quantity_supplied, unit, order_items(request_item_id)')
        .in('order_item_id', orderItems.map(oi => oi.id))
      if (!supplyData?.length) return
      const map = {}
      for (const sl of supplyData) {
        const riId = sl.order_items?.request_item_id
        if (riId) map[riId] = { qty: sl.quantity_supplied, unit: sl.unit }
      }
      setSupplyMap(map)
    }
    fetchSupply()
  }, [selected?.id, selected?.status])

  const openRequest = (req) => setSelected(req)
  const closePanel  = () => setSelected(null)

  const cancelRequest = async (id) => {
    setCancelling(true)
    const { error } = await supabase.from('requests').update({ status: 'cancelled' }).eq('id', id)
    setCancelling(false)
    if (error) {
      setToast({ message: 'Failed to cancel request. Try again.', type: 'error' })
      return
    }
    closePanel()
    setToast({ message: 'Request cancelled.', type: 'success' })
    fetchRequests()
  }

  const newRequestPath = profile?.role === 'housekeeper' ? '/requests/new/housekeeping' : '/requests/new'

  const isHousekeeper = profile?.role === 'housekeeper'

  // Apply filters (dept scoping is already done at query level)
  const displayed = requests
    .filter(r => filter === 'mine' ? r.chef_id === profile?.id : true)
    .filter(r => mealFilter ? r.meal_purpose === mealFilter : true)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 sm:px-6">
        <p className="text-red-600 text-sm text-center py-4">{loadError}</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:px-6">

      {/* Header — desktop New Request button */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">{isHousekeeper ? 'My Requests' : 'All Requests'}</h1>
        <div className="flex items-center gap-3">
          <button onClick={fetchRequests} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 cursor-pointer">
            ↻ Refresh
          </button>
          <button
            onClick={() => navigate(newRequestPath)}
            className="hidden md:block bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
          >
            + New Request
          </button>
        </div>
      </div>

      {/* Filter bar — chefs only; housekeepers always see only their own requests */}
      {!isHousekeeper && (
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="flex bg-gray-100 p-1 rounded-xl flex-1">
            {[['all', 'All Chefs'], ['mine', 'My Requests']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilter(val)}
                className={`flex-1 py-2 text-base font-medium rounded-lg transition-colors min-h-[44px] ${
                  filter === val ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={mealFilter}
            onChange={e => setMealFilter(e.target.value)}
            className="border border-gray-300 rounded-xl px-3 py-2 text-base text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] sm:w-40"
          >
            <option value="">All meals</option>
            {Object.entries(MEAL_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Empty state */}
      {displayed.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-5xl mb-3">📋</p>
          <p className="text-base text-gray-500 mb-5">
            {(isHousekeeper || filter === 'mine')
              ? "You haven't made any requests yet."
              : 'No requests found.'}
          </p>
          <button
            onClick={() => navigate(newRequestPath)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-5 py-3 rounded-xl min-h-[48px] transition-colors"
          >
            New Request
          </button>
        </div>
      ) : (
        <div className="space-y-3 pb-24 md:pb-6">
          {displayed.map(req => {
            const items      = req.request_items ?? []
            const approved   = items.filter(i => i.item_status === 'approved').length
            const rejected   = items.filter(i => i.item_status === 'rejected').length
            const isOwn      = req.chef_id === profile?.id
            const showReceipt = isOwn && needsReceiptIds.has(req.id)

            return (
              <div
                key={req.id}
                onClick={() => openRequest(req)}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-gray-900">
                      {req.chef?.full_name ?? 'Unknown chef'}
                      {isOwn && <span className="ml-1.5 text-sm text-blue-500 font-medium">(you)</span>}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      {req.meal_purpose && (
                        <p className="text-base text-gray-600">{MEAL_LABELS[req.meal_purpose] ?? req.meal_purpose}</p>
                      )}
                      <DeptTag department={req.department} />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={req.status} />
                    {req.status === 'closed' && orderedRequestIds.has(req.id) && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                        Order Placed
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{fmt(req.created_at)}</span>
                </div>

                {req.status === 'closed' && (
                  <div className="flex gap-3 text-sm font-medium mb-2">
                    <span className="text-green-600">{approved} approved</span>
                    <span className="text-red-600">{rejected} rejected</span>
                  </div>
                )}

                {/* Receipt confirmation button shown directly on card */}
                {showReceipt && (
                  <button
                    onClick={e => { e.stopPropagation(); navigate(`/requests/confirm/${req.id}`) }}
                    className="mt-1 w-full bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors min-h-[44px]"
                  >
                    Mark as Done — Confirm Receipt
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {requests.length === 100 && (
        <p className="text-xs text-gray-400 text-center py-3">
          Showing most recent 100 results. Use filters to narrow down.
        </p>
      )}

      {/* FAB — mobile only */}
      {!selected && (
        <button
          onClick={() => navigate(newRequestPath)}
          className="md:hidden fixed bottom-6 right-6 z-20 w-14 h-14 bg-blue-600 hover:bg-blue-700 rounded-full shadow-lg flex items-center justify-center text-white text-3xl leading-none transition-colors"
          aria-label="New Request"
        >
          +
        </button>
      )}

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          request={selected}
          isOwner={selected.chef_id === profile?.id}
          needsReceipt={needsReceiptIds.has(selected.id)}
          cancelling={cancelling}
          onClose={closePanel}
          onEdit={() => navigate(
            selected.department === 'housekeeping' ? '/requests/new/housekeeping' : '/requests/new',
            { state: { request: selected } }
          )}
          onCancel={() => cancelRequest(selected.id)}
          onConfirmReceipt={() => navigate(`/requests/confirm/${selected.id}`)}
          supplyMap={supplyMap}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
