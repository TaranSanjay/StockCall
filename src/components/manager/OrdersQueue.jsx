import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../shared/Navbar'

const MEAL_LABELS = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
  snacks: 'Snacks', other: 'Other',
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${dd}/${mm}/${yy}`
}

function OrderBadge({ hasOrder }) {
  return hasOrder ? (
    <span className="flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
      Order Placed
    </span>
  ) : (
    <span className="flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
      Order Pending
    </span>
  )
}

export default function OrdersQueue() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [filter, setFilter]     = useState('pending') // 'pending' | 'all'

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { data: reqs, error: reqErr } = await supabase
        .from('requests')
        .select('*, request_items(id, item_status)')
        .eq('status', 'closed')
        .order('updated_at', { ascending: false })
        .limit(100)
      if (reqErr) throw reqErr

      if (!reqs?.length) { setRequests([]); setLoading(false); return }

      const chefIds = [...new Set(reqs.map(r => r.chef_id))]
      const { data: chefProfiles, error: profErr } = await supabase
        .from('profiles').select('id, full_name').in('id', chefIds)
      if (profErr) throw profErr
      const pMap = Object.fromEntries((chefProfiles ?? []).map(p => [p.id, p]))

      const { data: ordersData, error: ordErr } = await supabase
        .from('orders').select('id, request_id, order_items(id)')
        .in('request_id', reqs.map(r => r.id))
      if (ordErr) throw ordErr
      const orderedIds = new Set((ordersData ?? []).map(o => o.request_id))

      const allOrderItemIds = (ordersData ?? []).flatMap(o => (o.order_items ?? []).map(oi => oi.id))
      let suppliedItemIds = new Set()
      if (allOrderItemIds.length) {
        const { data: slogs, error: slogErr } = await supabase
          .from('supply_logs').select('order_item_id')
          .in('order_item_id', allOrderItemIds)
        if (slogErr) throw slogErr
        suppliedItemIds = new Set((slogs ?? []).map(sl => sl.order_item_id))
      }

      const supplyStatusMap = {}
      ;(ordersData ?? []).forEach(o => {
        const ois = o.order_items ?? []
        supplyStatusMap[o.request_id] = ois.length > 0 && ois.every(oi => suppliedItemIds.has(oi.id))
      })

      setRequests(
        reqs
          .filter(r => (r.request_items ?? []).some(i => i.item_status === 'approved'))
          .map(r => ({
            ...r,
            chef:            pMap[r.chef_id] ?? null,
            hasOrder:        orderedIds.has(r.id),
            isFullySupplied: supplyStatusMap[r.id] ?? false,
          }))
      )
      setLoading(false)
    } catch {
      setLoadError('Something went wrong. Please refresh and try again.')
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const displayed = filter === 'pending'
    ? requests.filter(r => !r.hasOrder)
    : requests

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
        <div className="max-w-2xl mx-auto px-4 py-6 sm:px-6">
          <p className="text-red-600 text-sm text-center py-4">{loadError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-2xl mx-auto px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-bold text-gray-900">Orders</h1>
          <button onClick={load} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 cursor-pointer">
            ↻ Refresh
          </button>
        </div>

        {/* Filter toggle */}
        <div className="flex bg-gray-100 p-1 rounded-xl mb-5">
          {[['pending', 'Order Pending'], ['all', 'All Orders']].map(([val, label]) => (
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

        {requests.length === 100 && (
          <p className="text-xs text-gray-400 text-center py-3 mb-2">
            Showing most recent 100 results. Use filters to narrow down.
          </p>
        )}

        {/* Empty state */}
        {displayed.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-3">📦</p>
            <p className="text-base text-gray-500">
              {filter === 'pending'
                ? 'No orders pending. All caught up!'
                : 'No closed requests yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map(req => {
              const items    = req.request_items ?? []
              const approved = items.filter(i => i.item_status === 'approved').length

              return (
                <div
                  key={req.id}
                  onClick={() => navigate(`/requests/${req.id}/order`)}
                  className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-base font-bold text-gray-900">{req.chef?.full_name ?? 'Unknown chef'}</p>
                      <p className="text-base text-gray-600">{MEAL_LABELS[req.meal_purpose] ?? req.meal_purpose}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <OrderBadge hasOrder={req.hasOrder} />
                      {req.hasOrder && req.isFullySupplied && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
                          Supplied
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-400">
                      <span>{approved} approved item{approved !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>Closed {fmtDate(req.updated_at)}</span>
                    </div>
                    {req.hasOrder && !req.isFullySupplied && (
                      <button
                        onClick={e => { e.stopPropagation(); navigate(`/requests/${req.id}/supply`) }}
                        className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                      >
                        Supply to Kitchen →
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
