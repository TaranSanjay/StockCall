import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../shared/Navbar'
import StatusBadge from '../shared/StatusBadge'
import { downloadShoppingList } from '../../lib/excelExport'

const MEAL_LABELS = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
  snacks: 'Snacks', other: 'Other',
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

export default function RequestReview() {
  const { requestId }        = useParams()
  const { profile, signOut } = useAuth()
  const navigate             = useNavigate()

  const [request, setRequest]   = useState(null)
  const [chef, setChef]         = useState(null)
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)

  // Per-item rejection state
  const [rejecting, setRejecting]       = useState({}) // itemId → bool
  const [rejectNotes, setRejectNotes]   = useState({}) // itemId → string
  const [rejectErrors, setRejectErrors] = useState({}) // itemId → string
  const [actioning, setActioning]       = useState(new Set()) // itemIds in-flight

  const [shoppingListGenerated, setShoppingListGenerated] = useState(false)
  const [actionError, setActionError] = useState(null)

  const refreshItems = useCallback(async () => {
    const { data: reqItems } = await supabase
      .from('request_items').select('*').eq('request_id', requestId)
    if (reqItems) setItems(reqItems)
  }, [requestId])

  const fetchRequest = useCallback(async () => {
    const { data: req } = await supabase
      .from('requests').select('*').eq('id', requestId).single()
    if (req) {
      setRequest(req)
      setShoppingListGenerated(req.shopping_list_generated ?? false)
    }
    const { data: reqItems } = await supabase
      .from('request_items').select('*').eq('request_id', requestId)
    if (reqItems) setItems(reqItems)
    return req
  }, [requestId])

  useEffect(() => {
    const load = async () => {
      setLoadError(null)
      try {
        const { data: req, error: reqErr } = await supabase
          .from('requests').select('*').eq('id', requestId).single()
        if (reqErr) throw reqErr
        if (!req) { setLoading(false); return }
        setRequest(req)
        setShoppingListGenerated(req.shopping_list_generated ?? false)

        const { data: chefProfile, error: profErr } = await supabase
          .from('profiles').select('id, full_name').eq('id', req.chef_id).single()
        if (profErr) throw profErr
        setChef(chefProfile)

        const { data: reqItems, error: itemErr } = await supabase
          .from('request_items').select('*').eq('request_id', requestId)
        if (itemErr) throw itemErr
        setItems(reqItems ?? [])
        setLoading(false)
      } catch {
        setLoadError('Something went wrong. Please refresh and try again.')
        setLoading(false)
      }
    }
    load()
  }, [requestId])

  const pendingCount  = items.filter(i => i.item_status === 'pending').length
  const reviewedCount = items.length - pendingCount
  const approvedCount = items.filter(i => i.item_status === 'approved').length
  const allReviewed   = items.length > 0 && pendingCount === 0

  // ── Actions ──────────────────────────────────────────────────────────────────

  const approve = async (itemId) => {
    setActioning(prev => new Set([...prev, itemId]))
    setActionError(null)
    const { data, error } = await supabase.from('request_items').update({
      item_status: 'approved',
      acted_by: profile.id,
      acted_at: new Date().toISOString(),
    }).eq('id', itemId).eq('item_status', 'pending').select('id')
    if (error) {
      setActionError(error.message)
    } else if (!data || data.length === 0) {
      setActionError('This item was already reviewed by someone else. Refreshing…')
      await refreshItems()
    } else {
      const updatedReq = await fetchRequest()
      if (updatedReq?.status === 'closed') window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    setActioning(prev => { const n = new Set(prev); n.delete(itemId); return n })
  }

  const startReject = (itemId) => {
    setRejecting(prev => ({ ...prev, [itemId]: true }))
    setRejectErrors(prev => { const n = { ...prev }; delete n[itemId]; return n })
  }

  const cancelReject = (itemId) => {
    setRejecting(prev => { const n = { ...prev }; delete n[itemId]; return n })
    setRejectNotes(prev => { const n = { ...prev }; delete n[itemId]; return n })
    setRejectErrors(prev => { const n = { ...prev }; delete n[itemId]; return n })
  }

  const confirmReject = async (itemId) => {
    const note = rejectNotes[itemId]?.trim()
    if (!note) {
      setRejectErrors(prev => ({ ...prev, [itemId]: 'Please enter a reason.' }))
      return
    }
    setActioning(prev => new Set([...prev, itemId]))
    setActionError(null)
    const { data, error } = await supabase.from('request_items').update({
      item_status: 'rejected',
      acted_by: profile.id,
      acted_at: new Date().toISOString(),
      rejection_note: note,
    }).eq('id', itemId).eq('item_status', 'pending').select('id')
    if (error) {
      setActionError(error.message)
    } else if (!data || data.length === 0) {
      setActionError('This item was already reviewed by someone else. Refreshing…')
      cancelReject(itemId)
      await refreshItems()
    } else {
      const updatedReq = await fetchRequest()
      cancelReject(itemId)
      if (updatedReq?.status === 'closed') window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    setActioning(prev => { const n = new Set(prev); n.delete(itemId); return n })
  }

  const handleDownload = async () => {
    const approved = items.filter(i => i.item_status === 'approved')
    const today    = new Date().toISOString().split('T')[0]
    downloadShoppingList(approved, chef?.full_name ?? 'chef', today)
    if (!shoppingListGenerated) {
      await supabase.from('requests').update({
        shopping_list_generated:    true,
        shopping_list_generated_at: new Date().toISOString(),
        shopping_list_generated_by: profile.id,
      }).eq('id', requestId)
      setShoppingListGenerated(true)
    }
  }

  // ── Shared action UI (used in both mobile cards and desktop table) ────────────
  const renderActions = (item) => {
    if (item.item_status !== 'pending') return null
    const inProgress  = actioning.has(item.id)
    const isRejecting = !!rejecting[item.id]

    if (isRejecting) {
      return (
        <div className="space-y-2 w-full">
          <input
            autoFocus
            type="text"
            value={rejectNotes[item.id] ?? ''}
            onChange={e => setRejectNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') confirmReject(item.id) }}
            placeholder="Reason for rejection…"
            disabled={inProgress}
            className={`w-full border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-red-500 min-h-[44px] ${
              rejectErrors[item.id] ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
          />
          {rejectErrors[item.id] && (
            <p className="text-sm text-red-600">{rejectErrors[item.id]}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => cancelReject(item.id)}
              disabled={inProgress}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium py-2 rounded-lg min-h-[44px] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => confirmReject(item.id)}
              disabled={inProgress}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg min-h-[44px] transition-colors"
            >
              {inProgress ? 'Rejecting…' : 'Confirm Reject'}
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex gap-2">
        <button
          onClick={() => approve(item.id)}
          disabled={inProgress}
          className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg min-h-[44px] transition-colors"
        >
          {inProgress ? '…' : 'Approve'}
        </button>
        <button
          onClick={() => startReject(item.id)}
          disabled={inProgress}
          className="flex-1 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold py-2.5 rounded-lg min-h-[44px] transition-colors"
        >
          Reject
        </button>
      </div>
    )
  }

  // ── Loading / not found ───────────────────────────────────────────────────────

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

  if (!request) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar profile={profile} onSignOut={signOut} />
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-base text-gray-500">Request not found.</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-5 py-3 rounded-xl min-h-[48px] transition-colors"
          >
            Back to Queue
          </button>
        </div>
      </div>
    )
  }

  if (['draft', 'cancelled'].includes(request.status)) {
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
            <h1 className="text-xl font-bold text-gray-900">Review Request</h1>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-base font-semibold text-amber-800 mb-1">
              This request is {request.status} and cannot be reviewed.
            </p>
            <p className="text-sm text-amber-700">Only submitted or under-review requests can be reviewed.</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────────

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
          <h1 className="text-xl font-bold text-gray-900">Review Request</h1>
        </div>

        {/* Request info */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Requester</p>
              <p className="text-base font-semibold text-gray-900">{chef?.full_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{request.meal_purpose ? 'Purpose' : 'Department'}</p>
              {request.meal_purpose
                ? <p className="text-base text-gray-800">{MEAL_LABELS[request.meal_purpose] ?? request.meal_purpose}</p>
                : <p><span className="bg-teal-100 text-teal-700 text-xs rounded-full px-2 py-0.5">🧹 Housekeeping</span></p>
              }
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Submitted</p>
              <p className="text-base text-gray-800">{fmt(request.submitted_at)}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Status</p>
              <StatusBadge status={request.status} />
            </div>
          </div>
          {request.notes && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-base text-gray-700">{request.notes}</p>
            </div>
          )}
        </div>

        {/* Progress */}
        <p className="text-base text-gray-500 mb-4">
          <span className="font-semibold text-gray-900">{reviewedCount}</span> of{' '}
          <span className="font-semibold text-gray-900">{items.length}</span> items reviewed
        </p>

        {/* All-reviewed banner */}
        {allReviewed && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-5">
            <p className="text-base font-semibold text-green-800 mb-3">
              ✅ All items reviewed. Request closed.
            </p>
            {approvedCount > 0 ? (
              <button
                onClick={handleDownload}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base py-3 px-5 rounded-xl min-h-[48px] transition-colors"
              >
                Download Shopping List
              </button>
            ) : (
              <p className="text-sm text-gray-500">All items were rejected. No order needed.</p>
            )}
          </div>
        )}

        {actionError && (
          <p className="text-base text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            {actionError}
          </p>
        )}

        {/* Mobile — cards */}
        <div className="md:hidden space-y-3">
          {items.map(item => (
            <div
              key={item.id}
              className={`bg-white rounded-xl border shadow-sm p-4 ${
                item.item_status === 'rejected' ? 'border-red-100 bg-red-50' :
                item.item_status === 'approved' ? 'border-green-100 bg-green-50' :
                'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-gray-900">
                    {item.item_name}
                    {item.is_custom && (
                      <span className="ml-1.5 text-xs text-blue-500 font-medium">custom</span>
                    )}
                  </p>
                  <p className="text-sm text-gray-500">{item.quantity} {item.unit}</p>
                  {item.item_status === 'rejected' && item.rejection_note && (
                    <p className="text-sm text-red-600 italic mt-0.5">"{item.rejection_note}"</p>
                  )}
                </div>
                <StatusBadge status={item.item_status} />
              </div>
              {renderActions(item)}
            </div>
          ))}
        </div>

        {/* Desktop — table */}
        <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500">Item</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Qty</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500">Unit</th>
                <th className="text-center px-4 py-3 text-sm font-semibold text-gray-500">Status</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-500 min-w-[220px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(item => (
                <tr
                  key={item.id}
                  className={
                    item.item_status === 'rejected' ? 'bg-red-50' :
                    item.item_status === 'approved' ? 'bg-green-50' : ''
                  }
                >
                  <td className="px-4 py-4">
                    <p className="font-medium text-gray-900">
                      {item.item_name}
                      {item.is_custom && (
                        <span className="ml-1.5 text-xs text-blue-500 font-medium">custom</span>
                      )}
                    </p>
                    {item.item_status === 'rejected' && item.rejection_note && (
                      <p className="text-sm text-red-600 italic mt-0.5">"{item.rejection_note}"</p>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right text-gray-700">{item.quantity}</td>
                  <td className="px-4 py-4 text-gray-500">{item.unit}</td>
                  <td className="px-4 py-4 text-center"><StatusBadge status={item.item_status} /></td>
                  <td className="px-4 py-4">{renderActions(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
