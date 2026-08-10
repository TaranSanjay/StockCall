import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import StatusBadge from '../shared/StatusBadge'
import PurposeBadge from '../shared/PurposeBadge'
import Toast from '../shared/Toast'
import { PURPOSE_OPTIONS } from '../../lib/purposes'

const STATUS_OPTIONS = [
  { value: 'draft',     label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'closed',    label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
]

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

// ── Detail slide-over ─────────────────────────────────────────────────────────
function DetailPanel({ request, isOwner, cancelling, onClose, onEdit, onCancel }) {
  const items     = request.request_items ?? []
  const isDraft   = request.status === 'draft'
  const canCancel = isOwner && (request.status === 'draft' || request.status === 'submitted')

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col md:inset-auto md:right-0 md:top-0 md:bottom-0 md:w-[420px] md:rounded-none md:border-l md:border-gray-200">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="space-y-1.5 min-w-0 pr-2">
            <div className="flex items-center gap-2 flex-wrap">
              <PurposeBadge purpose={request.meal_purpose} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={request.status} />
              <span className="text-sm text-gray-500">
                {request.chef?.full_name ?? 'Unknown manager'}
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
                  </div>
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
        {isOwner && (isDraft || canCancel) && (
          <div className="px-5 py-4 border-t border-gray-200 flex-shrink-0 space-y-2.5">
            {isDraft && (
              <button onClick={onEdit}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base py-3 rounded-xl transition-colors min-h-[48px]">
                Edit Draft
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
export default function RequestsView() {
  const { profile }   = useAuth()
  const navigate      = useNavigate()
  const location      = useLocation()

  const [requests, setRequests]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(null)
  const [purposeFilter, setPurposeFilter] = useState('')
  const [statusFilter, setStatusFilter]   = useState('')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [selected, setSelected]       = useState(null)
  const [cancelling, setCancelling]   = useState(false)
  const [toast, setToast]             = useState(
    location.state?.toast ? { message: location.state.toast, type: 'success' } : null
  )

  useEffect(() => {
    if (location.state?.toast) window.history.replaceState({}, '')
  }, [location.state?.toast])

  const fetchData = useCallback(async () => {
    const { data: reqs, error: reqErr } = await supabase
      .from('requests')
      .select('*, request_items(*)')
      .order('created_at', { ascending: false })
    if (reqErr) throw reqErr

    if (!reqs?.length) return []

    const chefIds = [...new Set(reqs.map(r => r.chef_id))]
    const { data: chefProfiles, error: profErr } = await supabase
      .from('profiles').select('id, full_name').in('id', chefIds)
    if (profErr) throw profErr

    const pMap = Object.fromEntries((chefProfiles ?? []).map(p => [p.id, p]))
    return reqs.map(r => ({ ...r, chef: pMap[r.chef_id] ?? null }))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setRequests(await fetchData())
    } catch {
      setLoadError('Something went wrong. Please refresh and try again.')
    } finally {
      setLoading(false)
    }
  }, [fetchData])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const reqs = await fetchData()
        if (!cancelled) setRequests(reqs)
      } catch {
        if (!cancelled) setLoadError('Something went wrong. Please refresh and try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [fetchData])

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
    load()
  }

  const canCreate = ['manager', 'supermanager', 'admin'].includes(profile?.role)

  const displayed = requests
    .filter(r => purposeFilter ? r.meal_purpose === purposeFilter : true)
    .filter(r => statusFilter ? r.status === statusFilter : true)
    .filter(r => {
      const d = (r.created_at ?? '').split('T')[0]
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      return true
    })

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
        <h1 className="text-xl font-bold text-gray-900">Requests</h1>
        <div className="flex items-center gap-3">
          <button onClick={load} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 cursor-pointer">
            ↻ Refresh
          </button>
          {canCreate && (
            <button
              onClick={() => navigate('/requests/new')}
              className="hidden md:block bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
            >
              + New Request
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <select
          value={purposeFilter}
          onChange={e => setPurposeFilter(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-base text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] flex-1"
        >
          <option value="">All purposes</option>
          {PURPOSE_OPTIONS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-base text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] flex-1"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-3 mb-5">
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-base text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-base text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
        />
      </div>

      {/* Empty state */}
      {displayed.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-5xl mb-3">📋</p>
          <p className="text-base text-gray-500 mb-5">No requests found.</p>
          {canCreate && (
            <button
              onClick={() => navigate('/requests/new')}
              className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-5 py-3 rounded-xl min-h-[48px] transition-colors"
            >
              New Request
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3 pb-24 md:pb-6">
          {displayed.map(req => {
            const items = req.request_items ?? []
            const isOwn = req.chef_id === profile?.id

            return (
              <div
                key={req.id}
                onClick={() => openRequest(req)}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-gray-900">
                      {req.chef?.full_name ?? 'Unknown manager'}
                      {isOwn && <span className="ml-1.5 text-sm text-blue-500 font-medium">(you)</span>}
                    </p>
                    <div className="mt-0.5">
                      <PurposeBadge purpose={req.meal_purpose} />
                    </div>
                  </div>
                  <StatusBadge status={req.status} />
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{fmt(req.created_at)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* FAB — mobile only */}
      {canCreate && !selected && (
        <button
          onClick={() => navigate('/requests/new')}
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
          cancelling={cancelling}
          onClose={closePanel}
          onEdit={() => navigate('/requests/new', { state: { request: selected } })}
          onCancel={() => cancelRequest(selected.id)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
