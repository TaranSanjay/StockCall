import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { logError } from '../../lib/logError'
import Navbar from '../shared/Navbar'

export default function ConfirmReceipt() {
  const { requestId }        = useParams()
  const { profile, signOut } = useAuth()
  const navigate             = useNavigate()

  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState(null)
  const [supplyExists, setSupplyExists] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors]         = useState({})

  useEffect(() => {
    if (!profile?.id) return // wait for profile before checking ownership

    const load = async () => {
      setLoadError(null)
      try {
        const { data: req, error: reqCheckErr } = await supabase
          .from('requests').select('chef_id').eq('id', requestId).single()
        if (reqCheckErr) throw reqCheckErr
        if (!req) { setLoading(false); return }
        if (req.chef_id !== profile.id) { navigate('/dashboard'); return }

        const { data: orders, error: ordErr } = await supabase
          .from('orders').select('id').eq('request_id', requestId)
        if (ordErr) throw ordErr
        if (!orders?.length) { setLoading(false); return }

        const { data: orderItems, error: oiErr } = await supabase
          .from('order_items').select('id, item_name, unit, request_item_id')
          .in('order_id', orders.map(o => o.id))
        if (oiErr) throw oiErr
        if (!orderItems?.length) { setLoading(false); return }

        const reqItemIds = orderItems.map(oi => oi.request_item_id).filter(Boolean)
        const { data: reqItems, error: riErr } = reqItemIds.length
          ? await supabase.from('request_items').select('id, quantity, unit').in('id', reqItemIds)
          : { data: [], error: null }
        if (riErr) throw riErr
        const reqMap = Object.fromEntries((reqItems ?? []).map(ri => [ri.id, ri]))

        const oiMap = Object.fromEntries(orderItems.map(oi => [oi.id, oi]))

        const { data: supplyLogs, error: slErr } = await supabase
          .from('supply_logs').select('id, order_item_id, quantity_supplied, unit')
          .in('order_item_id', orderItems.map(oi => oi.id))
        if (slErr) throw slErr
        if (!supplyLogs?.length) { setLoading(false); return }
        setSupplyExists(true)

        const { data: confirmations, error: confErr } = await supabase
          .from('receipt_confirmations').select('supply_log_id')
          .in('supply_log_id', supplyLogs.map(sl => sl.id))
        if (confErr) throw confErr

        const confirmedIds = new Set((confirmations ?? []).map(c => c.supply_log_id))

        setItems(
          supplyLogs
            .filter(sl => !confirmedIds.has(sl.id))
            .map(sl => {
              const orderItem = oiMap[sl.order_item_id]
              const original  = reqMap[orderItem?.request_item_id]
              return {
                supplyLogId:      sl.id,
                orderItemId:      sl.order_item_id,
                itemName:         orderItem?.item_name ?? '—',
                originalQty:      original?.quantity ?? null,
                originalUnit:     original?.unit ?? orderItem?.unit ?? '',
                quantitySupplied: sl.quantity_supplied,
                unit:             sl.unit,
                quantityReceived: String(sl.quantity_supplied),
                note:             '',
              }
            })
        )
        setLoading(false)
      } catch {
        setLoadError('Something went wrong. Please refresh and try again.')
        setLoading(false)
      }
    }
    load()
  }, [requestId, profile?.id])

  const update = (supplyLogId, field, value) =>
    setItems(prev => prev.map(i => i.supplyLogId === supplyLogId ? { ...i, [field]: value } : i))

  const validate = () => {
    const errs = {}
    items.forEach(item => {
      const received = Number(item.quantityReceived)
      const supplied = Number(item.quantitySupplied)
      if (!item.quantityReceived || received <= 0)
        errs[`qty_${item.supplyLogId}`] = 'Enter a quantity.'
      if (received !== supplied && !item.note.trim())
        errs[`note_${item.supplyLogId}`] = 'Please explain the difference.'
    })
    return errs
  }

  const handleConfirm = async () => {
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setSubmitting(true)

    try {
      const rows = items.map(item => ({
        supply_log_id:     item.supplyLogId,
        confirmed_by:      profile.id,
        quantity_received: Number(item.quantityReceived),
        discrepancy_note:  item.note.trim() || null,
      }))
      const { error } = await supabase.from('receipt_confirmations').insert(rows)
      if (error) throw error

      navigate('/dashboard', { state: { toast: 'Receipt confirmed!' } })
    } catch (err) {
      logError('ConfirmReceipt', err.message, {
        requestId,
        supplyLogIds: items.map(i => i.supplyLogId),
      })
      setErrors({ submit: err.message })
    } finally {
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
        <div className="max-w-3xl mx-auto px-4 py-6 sm:px-6">
          <p className="text-red-600 text-sm text-center py-4">{loadError}</p>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    const emoji   = supplyExists ? '✅' : '⏳'
    const message = supplyExists
      ? "You've already confirmed receipt for all items."
      : "Items haven't been supplied to the kitchen yet."
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar profile={profile} onSignOut={signOut} />
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-4xl">{emoji}</p>
          <p className="text-base text-gray-500">{message}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-5 py-3 rounded-xl min-h-[48px] transition-colors"
          >
            Back to Requests
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-3xl mx-auto px-4 py-6 sm:px-6">

        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="min-h-[44px] min-w-[44px] flex items-center text-gray-500 hover:text-gray-800 text-base transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-xl font-bold text-gray-900">Check Received Items</h1>
        </div>

        <p className="text-base text-gray-600 mb-5">
          Check the quantity you actually received. Change it if it's different from what was supplied.
        </p>

        {/* ── Mobile: card layout ── */}
        <div className="md:hidden space-y-3 mb-5">
          {items.map(item => {
            const received = Number(item.quantityReceived)
            const supplied = Number(item.quantitySupplied)
            const differs  = item.quantityReceived !== '' && received !== supplied

            return (
              <div key={item.supplyLogId} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
                <p className="text-base font-semibold text-gray-900">{item.itemName}</p>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-500">
                  {item.originalQty != null && (
                    <>
                      <span>Originally requested</span>
                      <span className="text-gray-700 font-medium">{item.originalQty} {item.originalUnit}</span>
                    </>
                  )}
                  <span>Supplied</span>
                  <span className="text-gray-700 font-medium">{item.quantitySupplied} {item.unit}</span>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-500 whitespace-nowrap">Received</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    onWheel={e => e.target.blur()}
                    value={item.quantityReceived}
                    onChange={e => update(item.supplyLogId, 'quantityReceived', e.target.value)}
                    className={`w-24 border rounded-lg px-3 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                      errors[`qty_${item.supplyLogId}`] ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  <span className="text-sm text-gray-500">{item.unit}</span>
                </div>

                {errors[`qty_${item.supplyLogId}`] && (
                  <p className="text-base text-red-600">{errors[`qty_${item.supplyLogId}`]}</p>
                )}

                {differs && (
                  <div>
                    <label className="block text-sm font-medium text-amber-700 mb-1.5">
                      Why is the quantity different? <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={item.note}
                      onChange={e => update(item.supplyLogId, 'note', e.target.value)}
                      placeholder="e.g. 2 packets were damaged"
                      className={`w-full border rounded-lg px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] ${
                        errors[`note_${item.supplyLogId}`]
                          ? 'border-red-400 bg-red-50'
                          : 'border-amber-300 bg-amber-50'
                      }`}
                    />
                    {errors[`note_${item.supplyLogId}`] && (
                      <p className="text-base text-red-600 mt-1">{errors[`note_${item.supplyLogId}`]}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Desktop: table layout ── */}
        <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500">Item</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Originally Requested</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Supplied</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-gray-500">Received</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-500">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(item => {
                const received = Number(item.quantityReceived)
                const supplied = Number(item.quantitySupplied)
                const differs  = item.quantityReceived !== '' && received !== supplied

                return (
                  <tr key={item.supplyLogId} className={differs ? 'bg-amber-50' : ''}>
                    <td className="px-4 py-4 font-medium text-gray-900 whitespace-nowrap">{item.itemName}</td>
                    <td className="px-4 py-4 text-right text-gray-500 whitespace-nowrap">
                      {item.originalQty != null
                        ? `${item.originalQty} ${item.originalUnit}`
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-4 text-right text-gray-500 whitespace-nowrap">
                      {item.quantitySupplied} {item.unit}
                    </td>
                    <td className="px-4 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          onWheel={e => e.target.blur()}
                          value={item.quantityReceived}
                          onChange={e => update(item.supplyLogId, 'quantityReceived', e.target.value)}
                          className={`w-24 border rounded-lg px-2 py-2 text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                            errors[`qty_${item.supplyLogId}`] ? 'border-red-400 bg-red-50' : 'border-gray-300'
                          }`}
                        />
                        <span className="text-sm text-gray-500">{item.unit}</span>
                      </div>
                      {errors[`qty_${item.supplyLogId}`] && (
                        <p className="text-sm text-red-600 mt-1 text-right">{errors[`qty_${item.supplyLogId}`]}</p>
                      )}
                    </td>
                    <td className="px-4 py-4 min-w-[200px]">
                      {differs ? (
                        <>
                          <input
                            type="text"
                            value={item.note}
                            onChange={e => update(item.supplyLogId, 'note', e.target.value)}
                            placeholder="Explain the difference…"
                            className={`w-full border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] ${
                              errors[`note_${item.supplyLogId}`]
                                ? 'border-red-400 bg-red-50'
                                : 'border-amber-300'
                            }`}
                          />
                          {errors[`note_${item.supplyLogId}`] && (
                            <p className="text-sm text-red-600 mt-1">{errors[`note_${item.supplyLogId}`]}</p>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {errors.submit && (
          <p className="text-base text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            {errors.submit}
          </p>
        )}

        <button
          onClick={handleConfirm}
          disabled={submitting}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold text-base py-4 rounded-xl transition-colors min-h-[56px] mb-8"
        >
          {submitting ? 'Saving…' : 'Mark as Done'}
        </button>
      </div>
    </div>
  )
}
