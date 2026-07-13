import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../shared/Navbar'
import PurposeBadge from '../shared/PurposeBadge'

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${dd}/${mm}/${yy}`
}

function RequestCard({ req, action }) {
  const items = req.request_items ?? []
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-base font-bold text-gray-900">{req.chef?.full_name ?? 'Unknown manager'}</p>
          <div className="mt-0.5">
            <PurposeBadge purpose={req.meal_purpose} />
          </div>
        </div>
        {req.hasOrder && (
          <span className="flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
            Order Placed
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-400">
          <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>Submitted {fmtDate(req.submitted_at)}</span>
        </div>
        {action}
      </div>
    </div>
  )
}

export default function OrdersQueue() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const [readyToOrder, setReadyToOrder] = useState([])
  const [ordersPlaced, setOrdersPlaced] = useState([])
  const [activeTab, setActiveTab]       = useState('ready')
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { data: orders, error: ordErr } = await supabase
        .from('orders')
        .select('id, request_id, order_items(id)')
        .limit(200)
      if (ordErr) throw ordErr
      const orderedIds = new Set((orders ?? []).map(o => o.request_id))

      const { data: submittedReqs, error: reqErr } = await supabase
        .from('requests')
        .select('*, request_items(id)')
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: true })
        .limit(100)
      if (reqErr) throw reqErr

      const ready = (submittedReqs ?? []).filter(r => !orderedIds.has(r.id))

      let placed = []
      if (orderedIds.size) {
        const { data: placedReqs, error: placedErr } = await supabase
          .from('requests')
          .select('*, request_items(id)')
          .in('id', [...orderedIds])
          .order('updated_at', { ascending: false })
          .limit(100)
        if (placedErr) throw placedErr
        placed = placedReqs ?? []
      }

      const chefIds = [...new Set([...ready, ...placed].map(r => r.chef_id))]
      const { data: chefProfiles, error: profErr } = await supabase
        .from('profiles').select('id, full_name').in('id', chefIds)
      if (profErr) throw profErr
      const pMap = Object.fromEntries((chefProfiles ?? []).map(p => [p.id, p]))

      // Supply status for placed orders
      const orderItemIds = (orders ?? []).flatMap(o => (o.order_items ?? []).map(oi => oi.id))
      let suppliedItemIds = new Set()
      if (orderItemIds.length) {
        const { data: slogs, error: slogErr } = await supabase
          .from('supply_logs').select('order_item_id')
          .in('order_item_id', orderItemIds)
        if (slogErr) throw slogErr
        suppliedItemIds = new Set((slogs ?? []).map(sl => sl.order_item_id))
      }
      const supplyStatusMap = {}
      ;(orders ?? []).forEach(o => {
        const ois = o.order_items ?? []
        supplyStatusMap[o.request_id] = ois.length > 0 && ois.every(oi => suppliedItemIds.has(oi.id))
      })

      setReadyToOrder(ready.map(r => ({ ...r, chef: pMap[r.chef_id] ?? null, hasOrder: false })))
      setOrdersPlaced(placed.map(r => ({
        ...r,
        chef: pMap[r.chef_id] ?? null,
        hasOrder: true,
        isFullySupplied: supplyStatusMap[r.id] ?? false,
      })))
      setLoading(false)
    } catch {
      setLoadError('Something went wrong. Please refresh and try again.')
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

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

        {/* Tab bar */}
        <div className="border-b border-gray-200 flex mb-6">
          <button
            onClick={() => setActiveTab('ready')}
            className={activeTab === 'ready'
              ? 'border-b-2 border-blue-600 text-blue-600 font-medium bg-white px-6 py-3 text-sm'
              : 'text-gray-500 hover:text-gray-700 bg-white px-6 py-3 text-sm border-b-2 border-transparent'}
          >
            Ready to Order ({readyToOrder.length})
          </button>
          <button
            onClick={() => setActiveTab('placed')}
            className={activeTab === 'placed'
              ? 'border-b-2 border-blue-600 text-blue-600 font-medium bg-white px-6 py-3 text-sm'
              : 'text-gray-500 hover:text-gray-700 bg-white px-6 py-3 text-sm border-b-2 border-transparent'}
          >
            Orders Placed ({ordersPlaced.length})
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'ready' && (
          readyToOrder.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-2">✅</p>
              <p className="text-base text-gray-500">No requests waiting for an order.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {readyToOrder.map(req => (
                <RequestCard
                  key={req.id}
                  req={req}
                  action={
                    <button
                      onClick={() => navigate(`/requests/${req.id}/order`)}
                      className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Place Order →
                    </button>
                  }
                />
              ))}
            </div>
          )
        )}

        {activeTab === 'placed' && (
          ordersPlaced.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-2">📦</p>
              <p className="text-base text-gray-500">No orders placed yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {ordersPlaced.map(req => (
                <RequestCard
                  key={req.id}
                  req={req}
                  action={
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/requests/${req.id}/order`)}
                        className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                      >
                        View Order
                      </button>
                      {!req.isFullySupplied && (
                        <button
                          onClick={() => navigate(`/requests/${req.id}/supply`)}
                          className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                        >
                          Supply to Kitchen →
                        </button>
                      )}
                    </div>
                  }
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
