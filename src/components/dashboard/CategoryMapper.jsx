import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

export default function CategoryMapper({ categories, onCategoriesChange }) {
  const [dept, setDept]             = useState('kitchen')
  const [items, setItems]           = useState([])
  const [hkCategories, setHkCats]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [pendingCats, setPending]   = useState({})
  const [saving, setSaving]         = useState({})
  const [success, setSuccess]       = useState({})
  const [errors, setErrors]         = useState({})
  const [newCatName, setNewCat]     = useState('')
  const [addingCat, setAddingCat]   = useState(false)
  const [addCatError, setAddCatErr] = useState('')

  // Reset form state when switching dept
  useEffect(() => {
    setPending({})
    setSaving({})
    setSuccess({})
    setErrors({})
    setNewCat('')
    setAddCatErr('')
  }, [dept])

  const fetchItems = useCallback(async () => {
    setLoading(true)
    if (dept === 'kitchen') {
      const { data, error } = await supabase
        .from('checklist_items')
        .select(`
          id, item_name,
          item_categories(
            id, category_id,
            category:categories!category_id(id, name)
          )
        `)
        .eq('is_active', true)
        .order('item_name')
      if (!error) setItems(data ?? [])
    } else {
      const [{ data: hkItems }, { data: hkCats }] = await Promise.all([
        supabase
          .from('housekeeping_checklist_items')
          .select(`
            id, item_name,
            hk_item_categories(
              id, category_id,
              category:hk_categories!category_id(id, name)
            )
          `)
          .eq('is_active', true)
          .order('item_name'),
        supabase.from('hk_categories').select('id, name').order('name'),
      ])
      setItems(hkItems ?? [])
      setHkCats(hkCats ?? [])
    }
    setLoading(false)
  }, [dept])

  useEffect(() => { fetchItems() }, [fetchItems])

  // Categories list for dropdown options in the active dept
  const activeCats = dept === 'kitchen' ? categories : hkCategories

  // Which field holds category assignments on each item
  const catField = dept === 'kitchen' ? 'item_categories' : 'hk_item_categories'

  const uncategorised = items.filter(i => !(i[catField]?.length > 0))
  const categorised   = items.filter(i =>   i[catField]?.length > 0)

  const grouped = {}
  for (const item of categorised) {
    const catName = item[catField][0].category?.name ?? 'Unknown'
    if (!grouped[catName]) grouped[catName] = []
    grouped[catName].push(item)
  }

  const junctionTable = dept === 'kitchen' ? 'item_categories' : 'hk_item_categories'

  async function assignCategory(itemId, catId) {
    if (!catId) return
    setSaving(p => ({ ...p, [itemId]: true }))
    setErrors(p => ({ ...p, [itemId]: '' }))
    setSuccess(p => ({ ...p, [itemId]: false }))
    try {
      const { error } = await supabase
        .from(junctionTable)
        .upsert(
          { checklist_item_id: itemId, category_id: catId },
          { onConflict: 'checklist_item_id' }
        )
      if (error) throw error
      setSuccess(p => ({ ...p, [itemId]: true }))
      setTimeout(() => setSuccess(p => ({ ...p, [itemId]: false })), 2000)
      await fetchItems()
    } catch (err) {
      setErrors(p => ({ ...p, [itemId]: err.message ?? 'Error saving' }))
    } finally {
      setSaving(p => ({ ...p, [itemId]: false }))
    }
  }

  async function handleAddCategory() {
    const name = newCatName.trim()
    if (!name) { setAddCatErr('Enter a category name.'); return }
    if (activeCats.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      setAddCatErr('Category already exists.'); return
    }
    setAddingCat(true)
    setAddCatErr('')

    if (dept === 'kitchen') {
      const { data, error } = await supabase.from('categories').insert({ name }).select().single()
      setAddingCat(false)
      if (error) { setAddCatErr(error.message); return }
      setNewCat('')
      onCategoriesChange([...categories, data].sort((a, b) => a.name.localeCompare(b.name)))
    } else {
      const { data, error } = await supabase.from('hk_categories').insert({ name }).select().single()
      setAddingCat(false)
      if (error) { setAddCatErr(error.message); return }
      setNewCat('')
      setHkCats(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    }
  }

  const selCls = 'border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Department toggle */}
      <div className="flex bg-gray-100 p-1 rounded-xl max-w-xs">
        {[['kitchen', '🍳 Kitchen'], ['housekeeping', '🧹 Housekeeping']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setDept(val)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              dept === val ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Left: Uncategorised */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">
            Uncategorised{' '}
            <span className="text-gray-400 font-normal">({uncategorised.length})</span>
          </h3>
          {uncategorised.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">All items categorised ✓</p>
          ) : (
            <div className="space-y-2">
              {uncategorised.map(item => (
                <div key={item.id}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{item.item_name}</span>
                    <select
                      value={pendingCats[item.id] ?? ''}
                      onChange={e => setPending(p => ({ ...p, [item.id]: e.target.value }))}
                      className={selCls}
                    >
                      <option value="">Select…</option>
                      {activeCats.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => assignCategory(item.id, pendingCats[item.id])}
                      disabled={!pendingCats[item.id] || saving[item.id]}
                      className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {saving[item.id] ? '…' : 'Assign'}
                    </button>
                    {success[item.id] && <span className="text-green-600 text-sm font-medium">✓</span>}
                  </div>
                  {errors[item.id] && (
                    <p className="text-xs text-red-600 mt-0.5">{errors[item.id]}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Categorised */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">
            Categorised{' '}
            <span className="text-gray-400 font-normal">({categorised.length})</span>
          </h3>
          {categorised.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No items categorised yet.</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([catName, groupItems]) => (
                  <div key={catName}>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                      {catName}
                    </p>
                    <div className="space-y-2">
                      {groupItems.map(item => (
                        <div key={item.id}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">
                              {item.item_name}
                            </span>
                            <select
                              value={item[catField][0]?.category_id ?? ''}
                              onChange={e => assignCategory(item.id, e.target.value)}
                              disabled={saving[item.id]}
                              className={selCls}
                            >
                              {activeCats.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                            {saving[item.id]  && <span className="text-gray-400 text-xs">…</span>}
                            {success[item.id] && <span className="text-green-600 text-sm font-medium">✓</span>}
                          </div>
                          {errors[item.id] && (
                            <p className="text-xs text-red-600 mt-0.5">{errors[item.id]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Add new category */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-3">Add New Category</h3>
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="text"
            value={newCatName}
            onChange={e => { setNewCat(e.target.value); setAddCatErr('') }}
            onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
            placeholder="e.g. Spices & Condiments"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-48"
          />
          <button
            onClick={handleAddCategory}
            disabled={addingCat}
            className="text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {addingCat ? 'Adding…' : 'Add Category'}
          </button>
        </div>
        {addCatError && <p className="text-xs text-red-600 mt-2">{addCatError}</p>}
      </div>
    </div>
  )
}
