import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../shared/Navbar'

const UNITS = ['kg', 'g', 'litre', 'ml', 'pieces', 'packets', 'dozens', 'other']
const MEAL_PURPOSES = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch',     label: 'Lunch' },
  { value: 'dinner',    label: 'Dinner' },
  { value: 'snacks',    label: 'Snacks' },
  { value: 'other',     label: 'Other' },
]

export default function NewRequestForm() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const editingRequest = location.state?.request ?? null

  const [mealPurpose, setMealPurpose]           = useState(editingRequest?.meal_purpose ?? '')
  const [notes, setNotes]                       = useState(editingRequest?.notes ?? '')
  const [checklistItems, setChecklistItems]     = useState([])
  const [checkedItems, setCheckedItems]         = useState({})
  const [customItems, setCustomItems]           = useState([])
  const [loadingChecklist, setLoadingChecklist] = useState(true)
  const [saving, setSaving]                     = useState(false)
  const [cancelling, setCancelling]             = useState(false)
  const [errors, setErrors]                     = useState({})

  useEffect(() => {
    supabase
      .from('checklist_items')
      .select('id, item_name')
      .eq('is_active', true)
      .order('item_name')
      .then(({ data }) => {
        setChecklistItems(data ?? [])
        setLoadingChecklist(false)
      })
  }, [])

  useEffect(() => {
    if (!editingRequest?.request_items) return
    const checked = {}
    const custom  = []
    for (const item of editingRequest.request_items) {
      if (item.is_custom) {
        custom.push({ id: item.id, name: item.item_name, quantity: String(item.quantity), unit: item.unit })
      } else {
        checked[item.item_name] = { quantity: String(item.quantity), unit: item.unit }
      }
    }
    setCheckedItems(checked)
    setCustomItems(custom)
  }, [editingRequest])

  const toggleItem = (name) =>
    setCheckedItems(prev => {
      if (prev[name]) { const n = { ...prev }; delete n[name]; return n }
      return { ...prev, [name]: { quantity: '', unit: 'kg' } }
    })

  const updateChecked = (name, field, value) =>
    setCheckedItems(prev => ({ ...prev, [name]: { ...prev[name], [field]: value } }))

  const addCustom = () =>
    setCustomItems(prev => [...prev, { id: crypto.randomUUID(), name: '', quantity: '', unit: 'pieces' }])

  const updateCustom = (id, field, value) =>
    setCustomItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))

  const removeCustom = (id) =>
    setCustomItems(prev => prev.filter(i => i.id !== id))

  const validate = () => {
    const errs = {}
    if (!mealPurpose) errs.mealPurpose = 'Please choose a meal.'
    if (!Object.keys(checkedItems).length && !customItems.length)
      errs.items = 'Add at least one ingredient.'
    Object.entries(checkedItems).forEach(([name, { quantity }]) => {
      if (!quantity || Number(quantity) <= 0)
        errs[`qty_${name}`] = 'Enter a quantity.'
    })
    customItems.forEach(item => {
      if (!item.name.trim()) errs[`cname_${item.id}`] = 'Enter the item name.'
      if (!item.quantity || Number(item.quantity) <= 0) errs[`cqty_${item.id}`] = 'Enter a quantity.'
    })
    return errs
  }

  const save = async (status) => {
    if (editingRequest && !['draft', 'submitted'].includes(editingRequest.status)) {
      setErrors({ submit: 'This request can no longer be edited.' })
      return
    }
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setSaving(true)

    try {
      let requestId = editingRequest?.id

      const payload = {
        meal_purpose: mealPurpose,
        notes:        notes.trim() || null,
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
      }

      if (editingRequest) {
        // Update the request header
        const { error: updErr } = await supabase.from('requests').update(payload).eq('id', editingRequest.id)
        if (updErr) throw updErr

        // Fetch what's currently in the DB for this draft
        const { data: existingItems, error: fetchErr } = await supabase
          .from('request_items').select('id, item_name, is_custom').eq('request_id', editingRequest.id)
        if (fetchErr) throw fetchErr

        const existingNonCustomByName = Object.fromEntries(
          (existingItems ?? []).filter(i => !i.is_custom).map(i => [i.item_name, i.id])
        )
        const existingCustomIdSet = new Set(
          (existingItems ?? []).filter(i => i.is_custom).map(i => i.id)
        )

        const toUpdate = []
        const toInsert = []
        const newNonCustomNames = new Set()
        const newCustomDbIds    = new Set()

        for (const [name, { quantity, unit }] of Object.entries(checkedItems)) {
          newNonCustomNames.add(name)
          if (existingNonCustomByName[name] != null) {
            toUpdate.push({ id: existingNonCustomByName[name], quantity: Number(quantity), unit })
          } else {
            toInsert.push({ request_id: requestId, item_name: name, quantity: Number(quantity), unit, item_status: 'pending', is_custom: false })
          }
        }

        for (const item of customItems) {
          if (existingCustomIdSet.has(item.id)) {
            newCustomDbIds.add(item.id)
            toUpdate.push({ id: item.id, item_name: item.name.trim(), quantity: Number(item.quantity), unit: item.unit })
          } else {
            toInsert.push({ request_id: requestId, item_name: item.name.trim(), quantity: Number(item.quantity), unit: item.unit, item_status: 'pending', is_custom: true })
          }
        }

        // Updates first (non-destructive)
        for (const { id, ...fields } of toUpdate) {
          const { error: uErr } = await supabase.from('request_items').update(fields).eq('id', id)
          if (uErr) throw uErr
        }

        // Inserts (non-destructive)
        if (toInsert.length) {
          const { error: insErr } = await supabase.from('request_items').insert(toInsert)
          if (insErr) throw insErr
        }

        // Delete obsolete items only after inserts succeed
        const idsToDelete = (existingItems ?? [])
          .filter(i => i.is_custom ? !newCustomDbIds.has(i.id) : !newNonCustomNames.has(i.item_name))
          .map(i => i.id)
        if (idsToDelete.length) {
          const { error: delErr } = await supabase.from('request_items').delete().in('id', idsToDelete)
          if (delErr) throw delErr
        }
      } else {
        const { data: req, error } = await supabase
          .from('requests')
          .insert({ chef_id: profile.id, ...payload })
          .select('id')
          .single()
        if (error) throw error
        requestId = req.id

        const items = [
          ...Object.entries(checkedItems).map(([name, { quantity, unit }]) => ({
            request_id: requestId, item_name: name,
            quantity: Number(quantity), unit, item_status: 'pending', is_custom: false,
          })),
          ...customItems.map(item => ({
            request_id: requestId, item_name: item.name.trim(),
            quantity: Number(item.quantity), unit: item.unit, item_status: 'pending', is_custom: true,
          })),
        ]

        const { error: itemErr } = await supabase.from('request_items').insert(items)
        if (itemErr) throw itemErr
      }

      const toastMsg = status === 'submitted' ? 'Request sent!' : 'Draft saved.'
      navigate('/dashboard', { state: { toast: toastMsg } })
    } catch (err) {
      setErrors({ submit: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async () => {
    if (!editingRequest || editingRequest.status !== 'draft') return
    setCancelling(true)
    try {
      await supabase.from('requests').update({ status: 'cancelled' }).eq('id', editingRequest.id)
      navigate('/dashboard', { state: { toast: 'Request cancelled.' } })
    } catch {
      setErrors({ submit: 'Could not cancel the request. Please try again.' })
      setCancelling(false)
    }
  }

  const grouped = checklistItems.reduce((acc, item) => {
    const letter = item.item_name[0].toUpperCase()
    acc[letter] = acc[letter] ?? []
    acc[letter].push(item)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-2xl mx-auto px-4 py-6 sm:px-6">

        {/* Back + title */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="min-h-[44px] min-w-[44px] flex items-center text-gray-500 hover:text-gray-800 text-base transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            {editingRequest ? 'Edit Request' : 'New Request'}
          </h1>
        </div>

        <div className="space-y-5">

          {/* Meal */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <label className="block text-base font-medium text-gray-700 mb-2">
              Meal <span className="text-red-500">*</span>
            </label>
            <select
              value={mealPurpose}
              onChange={e => setMealPurpose(e.target.value)}
              className={`w-full border rounded-lg px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] ${
                errors.mealPurpose ? 'border-red-400' : 'border-gray-300'
              }`}
            >
              <option value="">Choose meal…</option>
              {MEAL_PURPOSES.map(mp => (
                <option key={mp.value} value={mp.value}>{mp.label}</option>
              ))}
            </select>
            {errors.mealPurpose && (
              <p className="text-base text-red-600 mt-1">{errors.mealPurpose}</p>
            )}
          </div>

          {/* Ingredient Checklist */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <h2 className="text-base font-medium text-gray-700 mb-3">
              Ingredients <span className="text-red-500">*</span>
            </h2>

            {loadingChecklist ? (
              <div className="flex justify-center py-10">
                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {Object.keys(grouped).length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-6">
                    No checklist items available. Use "Add Custom Item" below.
                  </p>
                )}
                {Object.keys(grouped).length > 0 && (
                  <div className="overflow-y-auto max-h-64 sm:max-h-80 rounded-lg border border-gray-100 divide-y divide-gray-100">
                    {Object.entries(grouped)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([letter, items]) => (
                        <div key={letter}>
                          <div className="sticky top-0 bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider">
                            {letter}
                          </div>
                          {items.map(item => (
                            <div key={item.id} className="px-3 py-3">
                              <div className="flex items-center gap-3 flex-wrap">
                                <input
                                  type="checkbox"
                                  id={`ci-${item.id}`}
                                  checked={!!checkedItems[item.item_name]}
                                  onChange={() => toggleItem(item.item_name)}
                                  className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0 cursor-pointer"
                                />
                                <label
                                  htmlFor={`ci-${item.id}`}
                                  className="flex-1 text-base text-gray-800 cursor-pointer"
                                >
                                  {item.item_name}
                                </label>

                                {checkedItems[item.item_name] && (
                                  <div className="flex items-center gap-2 ml-auto">
                                    <input
                                      type="number"
                                      min="0.5"
                                      step="0.5"
                                      onWheel={e => e.target.blur()}
                                      value={checkedItems[item.item_name].quantity}
                                      onChange={e => updateChecked(item.item_name, 'quantity', e.target.value)}
                                      placeholder="Qty"
                                      className={`w-20 rounded-lg border px-2 py-2 text-base text-center focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[44px] ${
                                        errors[`qty_${item.item_name}`] ? 'border-red-400' : 'border-gray-300'
                                      }`}
                                    />
                                    <select
                                      value={checkedItems[item.item_name].unit}
                                      onChange={e => updateChecked(item.item_name, 'unit', e.target.value)}
                                      className="rounded-lg border border-gray-300 px-2 py-2 text-base focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[44px]"
                                    >
                                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                  </div>
                                )}
                              </div>

                              {errors[`qty_${item.item_name}`] && (
                                <p className="text-sm text-red-600 mt-1 ml-8">
                                  {errors[`qty_${item.item_name}`]}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}

            {errors.items && (
              <p className="text-base text-red-600 mt-2">{errors.items}</p>
            )}
          </div>

          {/* Custom items */}
          {customItems.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h2 className="text-base font-medium text-gray-700 mb-3">Custom Items</h2>
              <div className="space-y-3">
                {customItems.map(item => (
                  <div key={item.id} className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={item.name}
                        onChange={e => updateCustom(item.id, 'name', e.target.value)}
                        placeholder="Item name"
                        className={`w-full border rounded-lg px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] ${
                          errors[`cname_${item.id}`] ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      {errors[`cname_${item.id}`] && (
                        <p className="text-sm text-red-600 mt-0.5">{errors[`cname_${item.id}`]}</p>
                      )}
                    </div>
                    <div>
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        onWheel={e => e.target.blur()}
                        value={item.quantity}
                        onChange={e => updateCustom(item.id, 'quantity', e.target.value)}
                        placeholder="Qty"
                        className={`w-20 border rounded-lg px-2 py-3 text-base text-center focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] ${
                          errors[`cqty_${item.id}`] ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      {errors[`cqty_${item.id}`] && (
                        <p className="text-sm text-red-600 mt-0.5">{errors[`cqty_${item.id}`]}</p>
                      )}
                    </div>
                    <select
                      value={item.unit}
                      onChange={e => updateCustom(item.id, 'unit', e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    >
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeCustom(item.id)}
                      className="w-11 h-12 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors text-2xl flex-shrink-0"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add custom item */}
          <button
            type="button"
            onClick={addCustom}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl py-4 text-base text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors min-h-[56px]"
          >
            + Add Custom Item
          </button>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <label className="block text-base font-medium text-gray-700 mb-2">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Any extra information…"
              className="w-full border border-gray-300 rounded-lg px-3 py-3 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {errors.submit && (
            <p className="text-base text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {errors.submit}
            </p>
          )}

          {/* Action buttons — stacked on mobile, side by side on sm+ */}
          <div className="space-y-3 pb-8">
            <div className="flex flex-col-reverse sm:flex-row gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => save('draft')}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-base py-3.5 rounded-xl disabled:opacity-50 transition-colors min-h-[52px]"
              >
                {saving ? 'Saving…' : 'Save as Draft'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => save('submitted')}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold text-base py-3.5 rounded-xl transition-colors min-h-[52px]"
              >
                {saving ? 'Sending…' : 'Send Request'}
              </button>
            </div>

            {editingRequest?.status === 'draft' && (
              <button
                type="button"
                disabled={cancelling}
                onClick={handleCancel}
                className="w-full border border-red-200 text-red-600 hover:bg-red-50 font-semibold text-base py-3.5 rounded-xl transition-colors min-h-[52px] disabled:opacity-50"
              >
                {cancelling ? 'Cancelling…' : 'Cancel Request'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
