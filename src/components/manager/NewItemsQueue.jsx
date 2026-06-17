import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../shared/Navbar'
import Toast from '../shared/Toast'

function fmtDateTime(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yy}, ${hh}:${min}`
}

export default function NewItemsQueue() {
  const { profile, signOut } = useAuth()

  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [filter, setFilter]     = useState('pending')
  const [toast, setToast]       = useState(null)
  const [acting, setActing]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { data: rows, error: rowErr } = await supabase
        .from('pending_checklist_items')
        .select('*')
        .order('requested_at', { ascending: false })
        .limit(100)
      if (rowErr) throw rowErr

      if (!rows?.length) { setItems([]); setLoading(false); return }

      const allUserIds = [
        ...new Set([
          ...rows.map(i => i.requested_by),
          ...rows.map(i => i.reviewed_by).filter(Boolean),
        ]),
      ]
      const { data: profiles, error: profErr } = await supabase
        .from('profiles').select('id, full_name').in('id', allUserIds)
      if (profErr) throw profErr
      const pMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))

      setItems(rows.map(i => ({
        ...i,
        requesterName: pMap[i.requested_by]?.full_name ?? 'Unknown',
        reviewerName:  i.reviewed_by ? (pMap[i.reviewed_by]?.full_name ?? 'Unknown') : null,
      })))
      setLoading(false)
    } catch {
      setLoadError('Something went wrong. Please refresh and try again.')
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleApprove(item) {
    setActing(item.id)
    try {
      const { error: insErr } = await supabase
        .from('checklist_items')
        .insert({ item_name: item.item_name, is_active: true })
      if (insErr) throw insErr

      const { error: updErr } = await supabase
        .from('pending_checklist_items')
        .update({
          status:      'approved',
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', item.id)
      if (updErr) throw updErr

      setToast({ message: 'Added to master checklist ✓', type: 'success' })
      await load()
    } catch {
      setToast({ message: 'Something went wrong. Try again.', type: 'error' })
    } finally {
      setActing(null)
    }
  }

  async function handleDismiss(item) {
    setActing(item.id)
    try {
      const { error } = await supabase
        .from('pending_checklist_items')
        .update({
          status:      'rejected',
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', item.id)
      if (error) throw error

      setToast({ message: 'Item dismissed', type: 'success' })
      await load()
    } catch {
      setToast({ message: 'Something went wrong. Try again.', type: 'error' })
    } finally {
      setActing(null)
    }
  }

  const displayed = filter === 'pending'
    ? items.filter(i => i.status === 'pending')
    : items

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
          <h1 className="text-xl font-bold text-gray-900">New Items</h1>
          <button
            onClick={load}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 cursor-pointer"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Filter toggle */}
        <div className="flex bg-gray-100 p-1 rounded-xl mb-5">
          {[['pending', 'Pending'], ['all', 'All']].map(([val, label]) => (
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

        {items.length === 100 && (
          <p className="text-xs text-gray-400 text-center py-3 mb-2">
            Showing most recent 100 results. Use filters to narrow down.
          </p>
        )}

        {/* Empty state */}
        {displayed.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-3">{filter === 'pending' ? '✅' : '📋'}</p>
            <p className="text-base text-gray-500">
              {filter === 'pending' ? 'No new items to review.' : 'No items submitted yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map(item => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <p className="text-base font-bold text-gray-900">{item.item_name}</p>
                  {item.status !== 'pending' && (
                    <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                      item.status === 'approved'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {item.status === 'approved' ? 'Added to List' : 'Dismissed'}
                    </span>
                  )}
                </div>

                <div className="text-sm text-gray-500 space-y-0.5 mb-3">
                  <p>
                    Requested by:{' '}
                    <span className="text-gray-700 font-medium">{item.requesterName}</span>
                  </p>
                  <p>
                    Requested at:{' '}
                    <span className="text-gray-700">{fmtDateTime(item.requested_at)}</span>
                  </p>
                  {item.status !== 'pending' && item.reviewerName && (
                    <>
                      <p>
                        Reviewed by:{' '}
                        <span className="text-gray-700 font-medium">{item.reviewerName}</span>
                      </p>
                      <p>
                        Reviewed at:{' '}
                        <span className="text-gray-700">{fmtDateTime(item.reviewed_at)}</span>
                      </p>
                    </>
                  )}
                </div>

                {item.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(item)}
                      disabled={acting === item.id}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {acting === item.id ? '…' : 'Add to List'}
                    </button>
                    <button
                      onClick={() => handleDismiss(item)}
                      disabled={acting === item.id}
                      className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
