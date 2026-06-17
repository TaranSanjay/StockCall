import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import StatusBadge from '../shared/StatusBadge'
import Toast from '../shared/Toast'

const MEAL_LABELS = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
  snacks: 'Snacks', other: 'Other',
}

function timeAgo(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function PendingQueue() {
  const navigate = useNavigate()
  const location = useLocation()

  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [toast, setToast]       = useState(location.state?.toast ?? null)

  useEffect(() => {
    if (location.state?.toast) window.history.replaceState({}, '')
  }, [location.state?.toast])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { data: reqs, error: reqErr } = await supabase
        .from('requests')
        .select('*, request_items(id, item_status)')
        .in('status', ['submitted', 'under_review'])
        .order('submitted_at', { ascending: true })
        .limit(100)
      if (reqErr) throw reqErr

      if (!reqs?.length) { setRequests([]); setLoading(false); return }

      const chefIds = [...new Set(reqs.map(r => r.chef_id))]
      const { data: chefProfiles, error: profErr } = await supabase
        .from('profiles').select('id, full_name').in('id', chefIds)
      if (profErr) throw profErr

      const pMap = Object.fromEntries((chefProfiles ?? []).map(p => [p.id, p]))
      setRequests(reqs.map(r => ({ ...r, chef: pMap[r.chef_id] ?? null })))
      setLoading(false)
    } catch {
      setLoadError('Something went wrong. Please refresh and try again.')
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

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
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">Pending Requests</h1>
        <button onClick={load} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 cursor-pointer">
          ↻ Refresh
        </button>
      </div>

      {requests.length === 100 && (
        <p className="text-xs text-gray-400 text-center py-3 mb-2">
          Showing most recent 100 results. Use filters to narrow down.
        </p>
      )}

      {requests.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-5xl mb-3">✅</p>
          <p className="text-base text-gray-500">All caught up. No pending requests.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => {
            const items   = req.request_items ?? []
            const pending = items.filter(i => i.item_status === 'pending').length

            return (
              <button
                key={req.id}
                onClick={() => navigate(`/requests/${req.id}/review`)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-blue-300 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-gray-900">{req.chef?.full_name ?? 'Unknown chef'}</p>
                    <p className="text-base text-gray-600">{MEAL_LABELS[req.meal_purpose] ?? req.meal_purpose}</p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-gray-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span className="text-gray-300">·</span>
                  <span className={pending > 0 ? 'text-amber-600 font-medium' : 'text-green-600 font-medium'}>
                    {pending > 0 ? `${pending} to review` : 'All reviewed'}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-400">{timeAgo(req.submitted_at)}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {toast && <Toast message={toast} type="success" onClose={() => setToast(null)} />}
    </div>
  )
}
