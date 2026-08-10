import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../shared/Navbar'
import CategoryMapper from './CategoryMapper'

const PURPOSE_FILTER_OPTIONS = [
  { value: '',                         label: 'All' },
  { value: 'kitchen',                  label: 'Kitchen' },
  { value: '89xquisit_housekeeping',   label: '89Xquisit HK' },
  { value: 'atlantis_housekeeping',    label: 'Atlantis HK' },
  { value: 'coffeeboard_housekeeping', label: 'Coffee Board HK' },
]

const CATEGORY_COLORS = {
  'Groceries':          '#3b82f6',
  'LPG Gas Cylinder':   '#f59e0b',
  'Dairy':              '#10b981',
  'Meats':              '#ef4444',
  'Cleaning & Hygiene': '#8b5cf6',
  'Beverages':          '#06b6d4',
  'Uncategorised':      '#9ca3af',
}
const FALLBACK_COLOR = '#6b7280'
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function isoDate(d) { return d.toISOString().slice(0, 10) }
function defaultFrom() { const d = new Date(); d.setDate(d.getDate() - 30); return isoDate(d) }
function defaultTo()   { return isoDate(new Date()) }

function getBucketKey(dateStr, granularity) {
  const d = new Date(dateStr)
  if (granularity === 'daily') {
    return dateStr.slice(0, 10)
  } else if (granularity === 'weekly') {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const w = Math.ceil(d.getDate() / 7)
    return `${y}-${m}-W${w}`
  } else {
    return dateStr.slice(0, 7)
  }
}

function formatBucketLabel(key, granularity) {
  if (granularity === 'daily') {
    const [, m, day] = key.split('-')
    return `${parseInt(day)} ${MONTH_NAMES[parseInt(m) - 1]}`
  } else if (granularity === 'weekly') {
    const parts = key.split('-')
    return `${MONTH_NAMES[parseInt(parts[1]) - 1]} ${parts[2]}`
  } else {
    const [y, m] = key.split('-')
    return `${MONTH_NAMES[parseInt(m) - 1]} ${y}`
  }
}

function fmtCurrency(v) {
  return '₹' + Number(v).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Category names visible for the current scope — merges kitchen + housekeeping when scope is 'all'
function catNamesForScope(scope, kitchenCats, hkCats) {
  if (scope === 'kitchen') return [...kitchenCats.map(c => c.name), 'Uncategorised']
  if (scope === 'housekeeping') return [...hkCats.map(c => c.name), 'Uncategorised']
  return [...new Set([...kitchenCats.map(c => c.name), ...hkCats.map(c => c.name)]), 'Uncategorised']
}

// base/tax/amountPaid for a single order_item
function itemAmounts(item) {
  const base = Number(item.total_price) || 0
  const gst  = Number(item.gst_percent) || 0
  const paid = base * (1 + gst / 100)
  return { base, tax: paid - base, paid }
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${dd}/${mm}/${yy}`
}

function CategoryDot({ name }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full flex-shrink-0"
      style={{ backgroundColor: CATEGORY_COLORS[name] ?? FALLBACK_COLOR }}
    />
  )
}

export default function ExpenditureDashboard() {
  const { profile, signOut } = useAuth()

  const [purpose, setPurpose]           = useState('')
  // scope: 'all' shows both departments combined, otherwise a single department
  const scope = purpose === '' ? 'all' : (purpose === 'kitchen' ? 'kitchen' : 'housekeeping')
  const [dateFrom, setDateFrom]         = useState(defaultFrom)
  const [dateTo, setDateTo]             = useState(defaultTo)
  const [granularity, setGranularity]   = useState('weekly')
  const [categories, setCategories]     = useState([])   // kitchen categories
  const [hkCategories, setHkCategories] = useState([])   // housekeeping categories
  const [selectedCats, setSelectedCats] = useState(new Set())

  const [rawItems, setRawItems]         = useState([])
  const [orderDateMap, setOrderDateMap] = useState({})
  const [fetching, setFetching]         = useState(true)
  const [fetchError, setFetchError]     = useState(null)

  const [mapperOpen, setMapperOpen]     = useState(false)
  // Item Details table — filters, sort, pagination
  const [itemCatFilter, setItemCatFilter] = useState('')
  const [itemSearch, setItemSearch]       = useState('')
  const [itemSort, setItemSort]           = useState({ key: 'date', dir: 'desc' })
  const [itemPage, setItemPage]           = useState(1)
  const ITEMS_PER_PAGE = 20

  useEffect(() => { document.title = 'Expenditure Dashboard · Stock Call' }, [])

  // Fetch categories whenever scope changes — 'all' needs both kitchen and housekeeping lists
  useEffect(() => {
    async function loadCategories() {
      const needKitchen = scope === 'kitchen' || scope === 'all'
      const needHk       = scope === 'housekeeping' || scope === 'all'

      const [kitchenRes, hkRes] = await Promise.all([
        needKitchen ? supabase.from('categories').select('id, name').order('name') : Promise.resolve({ data: [] }),
        needHk ? supabase.from('hk_categories').select('id, name').order('name') : Promise.resolve({ data: [] }),
      ])

      const kitchenCats = kitchenRes.data ?? []
      const hkCats       = hkRes.data ?? []
      setCategories(needKitchen ? kitchenCats : [])
      setHkCategories(needHk ? hkCats : [])
      setSelectedCats(new Set(catNamesForScope(scope, needKitchen ? kitchenCats : [], needHk ? hkCats : [])))
    }
    loadCategories()
  }, [scope])

  // Fetch raw order_items when date range or scope changes
  useEffect(() => {
    let cancelled = false
    async function load() {
      setFetching(true)
      setFetchError(null)
      try {
        const fromISO = dateFrom + 'T00:00:00'
        const toISO   = dateTo   + 'T23:59:59'

        // Step 1: fetch orders in date range
        const { data: allOrders, error: ordErr } = await supabase
          .from('orders')
          .select('id, placed_at, request_id, payment_method')
          .gte('placed_at', fromISO)
          .lte('placed_at', toISO)
        if (ordErr) throw ordErr

        if (!allOrders?.length) {
          if (!cancelled) { setRawItems([]); setOrderDateMap({}) }
          return
        }

        // Step 2: fetch requests for department/purpose filter
        const reqIds = [...new Set(allOrders.map(o => o.request_id).filter(Boolean))]
        const { data: reqs, error: reqErr } = await supabase
          .from('requests').select('id, department, meal_purpose').in('id', reqIds)
        if (reqErr) throw reqErr

        const reqMap = Object.fromEntries((reqs ?? []).map(r => [r.id, r]))

        const filteredOrders = allOrders.filter(o => {
          const r = reqMap[o.request_id]
          if (!r) return false
          const isKitchen = r.department === 'kitchen' || !r.department
          if (scope === 'kitchen') return isKitchen
          if (scope === 'housekeeping') return !isKitchen && r.meal_purpose === purpose
          return true // 'all' — every department/purpose included
        })

        if (!filteredOrders.length) {
          if (!cancelled) { setRawItems([]); setOrderDateMap({}) }
          return
        }

        const orderIds = filteredOrders.map(o => o.id)
        const dateMap    = Object.fromEntries(filteredOrders.map(o => [o.id, o.placed_at]))
        const paymentMap = Object.fromEntries(filteredOrders.map(o => [o.id, o.payment_method]))

        // Department each order belongs to — needed to resolve categories per-item in 'all' scope
        const orderDeptMap = Object.fromEntries(filteredOrders.map(o => {
          const r = reqMap[o.request_id]
          const isKitchen = r?.department === 'kitchen' || !r?.department
          return [o.id, isKitchen ? 'kitchen' : 'housekeeping']
        }))

        // Step 3: fetch order_items (flat — no joins)
        const { data: orderItems, error: itmErr } = await supabase
          .from('order_items')
          .select('id, order_id, item_name, total_price, gst_percent, price_per_unit, quantity_ordered, unit')
          .in('order_id', orderIds)
        if (itmErr) throw itmErr

        if (!orderItems?.length) {
          if (!cancelled) { setRawItems([]); setOrderDateMap(dateMap) }
          return
        }

        // Steps 4-6: name → checklist item id → category id → category name, for whichever
        // department(s) are actually present in this view
        const needKitchen = scope === 'kitchen' || scope === 'all'
        const needHk       = scope === 'housekeeping' || scope === 'all'

        const [kChecklist, kItemCats, kCats, hChecklist, hItemCats, hCats] = await Promise.all([
          needKitchen ? supabase.from('checklist_items').select('id, item_name') : Promise.resolve({ data: [] }),
          needKitchen ? supabase.from('item_categories').select('checklist_item_id, category_id') : Promise.resolve({ data: [] }),
          needKitchen ? supabase.from('categories').select('id, name') : Promise.resolve({ data: [] }),
          needHk ? supabase.from('housekeeping_checklist_items').select('id, item_name') : Promise.resolve({ data: [] }),
          needHk ? supabase.from('hk_item_categories').select('hk_checklist_item_id, hk_category_id') : Promise.resolve({ data: [] }),
          needHk ? supabase.from('hk_categories').select('id, name') : Promise.resolve({ data: [] }),
        ])

        const kitchenNameToId   = new Map((kChecklist.data ?? []).map(ci => [ci.item_name.toLowerCase().trim(), ci.id]))
        const kitchenIdToCatId  = new Map((kItemCats.data ?? []).map(ic => [ic.checklist_item_id, ic.category_id]))
        const kitchenCatIdName  = new Map((kCats.data ?? []).map(c => [c.id, c.name]))

        const hkNameToId   = new Map((hChecklist.data ?? []).map(ci => [ci.item_name.toLowerCase().trim(), ci.id]))
        const hkIdToCatId  = new Map((hItemCats.data ?? []).map(ic => [ic.hk_checklist_item_id, ic.hk_category_id]))
        const hkCatIdName  = new Map((hCats.data ?? []).map(c => [c.id, c.name]))

        // Step 7: enrich each order_item with its resolved category name, using the
        // department its own request belongs to (not a single global department)
        const assembled = orderItems.map(oi => {
          const itemDept    = orderDeptMap[oi.order_id] ?? 'kitchen'
          const nameToId    = itemDept === 'kitchen' ? kitchenNameToId  : hkNameToId
          const idToCatId   = itemDept === 'kitchen' ? kitchenIdToCatId : hkIdToCatId
          const catIdToName = itemDept === 'kitchen' ? kitchenCatIdName : hkCatIdName

          const checklistId = nameToId.get(oi.item_name?.toLowerCase().trim() ?? '')
          const catId       = checklistId ? idToCatId.get(checklistId) : null
          return {
            ...oi,
            _catName: catId ? (catIdToName.get(catId) ?? 'Uncategorised') : 'Uncategorised',
            date: dateMap[oi.order_id],
            payment_method: paymentMap[oi.order_id],
          }
        })

        if (!cancelled) {
          setRawItems(assembled)
          setOrderDateMap(dateMap)
        }
      } catch {
        if (!cancelled) setFetchError('Failed to load data. Please try again.')
      } finally {
        if (!cancelled) setFetching(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [dateFrom, dateTo, scope, purpose])

  const { chartData, summary } = useMemo(() => {
    const buckets = {}
    let preTax = 0, tax = 0

    for (const item of rawItems) {
      const base = Number(item.total_price) || 0
      const rate = (Number(item.gst_percent) || 0) / 100
      const paid = base * (1 + rate)

      const catName = item._catName ?? 'Uncategorised'

      // selectedCats.size === 0 means categories haven't loaded — include everything
      if (selectedCats.size > 0 && !selectedCats.has(catName)) continue

      const placedAt = orderDateMap[item.order_id]
      if (!placedAt) continue

      const key = getBucketKey(placedAt, granularity)
      if (!buckets[key]) buckets[key] = {}
      buckets[key][catName] = (buckets[key][catName] ?? 0) + paid

      preTax += base
      tax    += (paid - base)
    }

    const sortedKeys = Object.keys(buckets).sort()
    return {
      chartData: sortedKeys.map(key => ({
        period: formatBucketLabel(key, granularity),
        ...buckets[key],
      })),
      summary: { preTax, tax, grand: preTax + tax },
    }
  }, [rawItems, orderDateMap, granularity, selectedCats])

  const allCats = catNamesForScope(scope, categories, hkCategories)
  const isAllSelected = allCats.length > 0 && allCats.every(c => selectedCats.has(c))

  function toggleCat(name) {
    setSelectedCats(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }
  function selectAll() { setSelectedCats(new Set(allCats)) }

  const activeCatsInData = new Set(chartData.flatMap(row => Object.keys(row).filter(k => k !== 'period')))
  const chartLines = allCats.filter(c => selectedCats.has(c) && activeCatsInData.has(c))

  const hasData = !fetching && !fetchError && rawItems.length > 0

  // ── Section 1: Spend by Category — respects the category pill selection ──
  const categoryBreakdown = useMemo(() => {
    const map = {}
    for (const item of rawItems) {
      const cat = item._catName ?? 'Uncategorised'
      if (selectedCats.size > 0 && !selectedCats.has(cat)) continue
      const { base, tax, paid } = itemAmounts(item)
      if (!map[cat]) map[cat] = { category: cat, items: 0, preTax: 0, tax: 0, total: 0 }
      map[cat].items += 1
      map[cat].preTax += base
      map[cat].tax    += tax
      map[cat].total  += paid
    }
    const rows  = Object.values(map).sort((a, b) => b.total - a.total)
    const grand = rows.reduce((s, r) => s + r.total, 0)
    return { rows, grand }
  }, [rawItems, selectedCats])

  // ── Section 3: Top 10 items by total amount paid (full period, not category-filtered) ──
  const topItems = useMemo(() => {
    const map = {}
    for (const item of rawItems) {
      const { paid } = itemAmounts(item)
      const name = item.item_name ?? '—'
      if (!map[name]) map[name] = { name, category: item._catName, total: 0, orderIds: new Set() }
      map[name].total += paid
      if (item.order_id != null) map[name].orderIds.add(item.order_id)
    }
    return Object.values(map)
      .map(r => ({ ...r, orderCount: r.orderIds.size }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  }, [rawItems])
  const topItemMax = topItems[0]?.total || 1

  // ── Section 4: Payment method split (full period, not category-filtered) ──
  const paymentTotals = useMemo(() => {
    const totals = { cash: 0, upi: 0, card: 0, netbanking: 0 }
    const orderMethod = {}
    for (const item of rawItems) {
      const { paid } = itemAmounts(item)
      const method = item.payment_method
      if (method && method in totals) totals[method] += paid
      if (method && item.order_id != null) orderMethod[item.order_id] = method
    }
    const counts = { cash: 0, upi: 0, card: 0, netbanking: 0 }
    for (const method of Object.values(orderMethod)) {
      if (method in counts) counts[method] += 1
    }
    return { totals, counts }
  }, [rawItems])

  // ── Section 2: Item Details — its own category filter + search + sort + pagination ──
  const itemDetailRows = useMemo(() => {
    let rows = rawItems.filter(item => {
      if (itemCatFilter && item._catName !== itemCatFilter) return false
      if (itemSearch && !(item.item_name ?? '').toLowerCase().includes(itemSearch.toLowerCase())) return false
      return true
    })
    rows = [...rows].sort((a, b) => {
      if (itemSort.key === 'date') {
        const da = a.date ?? '', db = b.date ?? ''
        return itemSort.dir === 'asc' ? da.localeCompare(db) : db.localeCompare(da)
      }
      if (itemSort.key === 'amount') {
        const pa = itemAmounts(a).paid, pb = itemAmounts(b).paid
        return itemSort.dir === 'asc' ? pa - pb : pb - pa
      }
      // name
      const na = a.item_name ?? '', nb = b.item_name ?? ''
      return itemSort.dir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na)
    })
    return rows
  }, [rawItems, itemCatFilter, itemSearch, itemSort])

  const itemTotalPages = Math.max(1, Math.ceil(itemDetailRows.length / ITEMS_PER_PAGE))
  const itemPageClamped = Math.min(itemPage, itemTotalPages)
  const itemPageRows = itemDetailRows.slice(
    (itemPageClamped - 1) * ITEMS_PER_PAGE,
    itemPageClamped * ITEMS_PER_PAGE
  )

  function setItemCatFilterAndResetPage(value) { setItemCatFilter(value); setItemPage(1) }
  function setItemSearchAndResetPage(value)    { setItemSearch(value);    setItemPage(1) }
  function setItemSortAndResetPage(next)       { setItemSort(next);       setItemPage(1) }

  function toggleItemSort(key, defaultDir) {
    setItemSortAndResetPage(itemSort.key === key
      ? { key, dir: itemSort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: defaultDir })
  }

  const PAYMENT_CARD_STYLES = {
    cash:       { label: 'Cash',          cls: 'bg-green-50 border-green-200 text-green-700' },
    upi:        { label: 'UPI',           cls: 'bg-blue-50 border-blue-200 text-blue-700' },
    card:       { label: 'Credit Card',   cls: 'bg-purple-50 border-purple-200 text-purple-700' },
    netbanking: { label: 'Net Banking',   cls: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Expenditure Dashboard</h1>

        {/* ── Controls ── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5 space-y-4">

          {/* Date range + granularity + purpose */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Purpose</label>
              <select
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PURPOSE_FILTER_OPTIONS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Granularity</label>
              <div className="flex bg-gray-100 p-0.5 rounded-lg">
                {[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setGranularity(val)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      granularity === val
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Category pills */}
          {allCats.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={selectAll}
                className={`px-3 py-1 text-sm font-medium rounded-full border transition-colors ${
                  isAllSelected
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-gray-100 text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                All
              </button>
              {allCats.map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleCat(cat)}
                  className={`px-3 py-1 text-sm font-medium rounded-full border transition-colors ${
                    selectedCats.has(cat)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-100 text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Chart ── */}
        {fetching ? (
          <div className="flex items-center justify-center h-80 bg-white rounded-xl border border-gray-200 shadow-sm mb-5">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : fetchError ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm mb-5">
            {fetchError}
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-80 bg-white rounded-xl border border-gray-200 shadow-sm mb-5">
            <p className="text-4xl mb-3">📊</p>
            <p className="text-base text-gray-500">No orders found in this date range.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
            <ResponsiveContainer width="100%" height={384}>
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 10, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  height={60}
                />
                <YAxis
                  tickFormatter={(v) =>
                    v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${v}`
                  }
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  width={60}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `₹${Number(value).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`,
                    name,
                  ]}
                  contentStyle={{
                    fontSize: 13,
                    borderRadius: '8px',
                    border: '1px solid #e5e7eb',
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                />
                {chartLines.map(cat => (
                  <Bar
                    key={cat}
                    dataKey={cat}
                    stackId="a"
                    fill={CATEGORY_COLORS[cat] ?? FALLBACK_COLOR}
                    radius={
                      cat === chartLines[chartLines.length - 1]
                        ? [4, 4, 0, 0]
                        : [0, 0, 0, 0]
                    }
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Summary row ── */}
        {!fetching && !fetchError && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              ['Total Spent (pre-tax)', summary.preTax],
              ['Total Tax Paid',        summary.tax],
              ['Grand Total',           summary.grand],
            ].map(([label, val]) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
                <p className="text-xs text-gray-500 mb-1 leading-tight">{label}</p>
                <p className="text-base font-bold text-gray-900">{fmtCurrency(val)}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Insights ── */}
        {hasData && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Insights</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Section 1 — Spend by Category */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Spend by Category</h2>
              {categoryBreakdown.rows.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No data for the selected categories.</p>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
                          <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Items Ordered</th>
                          <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Pre-Tax Spend</th>
                          <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Tax</th>
                          <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Total Spend</th>
                          <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide">% of Grand Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoryBreakdown.rows.map(row => (
                          <tr key={row.category} className="border-b border-gray-100 text-gray-900 hover:bg-gray-50">
                            <td className="py-2 px-2">
                              <span className="flex items-center gap-2"><CategoryDot name={row.category} />{row.category}</span>
                            </td>
                            <td className="py-2 px-2 text-right">{row.items}</td>
                            <td className="py-2 px-2 text-right">{fmtCurrency(row.preTax)}</td>
                            <td className="py-2 px-2 text-right">{fmtCurrency(row.tax)}</td>
                            <td className="py-2 px-2 text-right font-medium">{fmtCurrency(row.total)}</td>
                            <td className="py-2 px-2 text-right">
                              {categoryBreakdown.grand > 0 ? ((row.total / categoryBreakdown.grand) * 100).toFixed(1) : '0.0'}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold text-gray-900">
                          <td className="py-2 px-2">Total</td>
                          <td className="py-2 px-2 text-right">{categoryBreakdown.rows.reduce((s, r) => s + r.items, 0)}</td>
                          <td className="py-2 px-2 text-right">{fmtCurrency(categoryBreakdown.rows.reduce((s, r) => s + r.preTax, 0))}</td>
                          <td className="py-2 px-2 text-right">{fmtCurrency(categoryBreakdown.rows.reduce((s, r) => s + r.tax, 0))}</td>
                          <td className="py-2 px-2 text-right">{fmtCurrency(categoryBreakdown.grand)}</td>
                          <td className="py-2 px-2 text-right">100.0%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="md:hidden space-y-3">
                    {categoryBreakdown.rows.map(row => (
                      <div key={row.category} className="border border-gray-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="flex items-center gap-2 font-medium text-gray-900">
                            <CategoryDot name={row.category} />{row.category}
                          </span>
                          <span className="text-sm font-semibold text-gray-900">{fmtCurrency(row.total)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
                          <span>Items: {row.items}</span>
                          <span className="text-right">
                            {categoryBreakdown.grand > 0 ? ((row.total / categoryBreakdown.grand) * 100).toFixed(1) : '0.0'}% of total
                          </span>
                          <span>Pre-Tax: {fmtCurrency(row.preTax)}</span>
                          <span className="text-right">Tax: {fmtCurrency(row.tax)}</span>
                        </div>
                      </div>
                    ))}
                    <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold text-sm text-gray-900">
                      <span>Total</span>
                      <span>{fmtCurrency(categoryBreakdown.grand)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Sections 3 + 4 — side by side on desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

              {/* Section 3 — Most Spent On */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Most Spent On</h2>
                {topItems.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No items in this period.</p>
                ) : (
                  <div className="space-y-3">
                    {topItems.map((item, idx) => (
                      <div key={item.name}>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-gray-400 font-medium w-5 flex-shrink-0">#{idx + 1}</span>
                            <span className="truncate text-gray-900">{item.name}</span>
                            <CategoryDot name={item.category} />
                          </span>
                          <span className="flex-shrink-0 text-right whitespace-nowrap">
                            <span className="font-semibold text-gray-900">{fmtCurrency(item.total)}</span>
                            <span className="text-xs text-gray-400 ml-1">
                              (across {item.orderCount} order{item.orderCount !== 1 ? 's' : ''})
                            </span>
                          </span>
                        </div>
                        <div className="mt-1 h-1 bg-blue-100 rounded-full overflow-hidden">
                          <div
                            className="h-1 bg-blue-500 rounded-full"
                            style={{ width: `${(item.total / topItemMax) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 4 — Payment Methods */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Payment Methods</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {['cash', 'upi', 'card', 'netbanking'].map(method => {
                    const style = PAYMENT_CARD_STYLES[method]
                    return (
                      <div key={method} className={`rounded-xl border p-4 text-center ${style.cls}`}>
                        <p className="text-xs font-medium mb-1">{style.label}</p>
                        <p className="text-base font-bold">{fmtCurrency(paymentTotals.totals[method])}</p>
                        <p className="text-xs mt-0.5">
                          {paymentTotals.counts[method]} order{paymentTotals.counts[method] !== 1 ? 's' : ''}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Section 2 — Item Details (last, most detail) */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Item Details</h2>

              {/* Filters */}
              <div className="flex flex-wrap gap-3 mb-4">
                <select
                  value={itemCatFilter}
                  onChange={e => setItemCatFilterAndResetPage(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Categories</option>
                  {allCats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  type="text"
                  value={itemSearch}
                  onChange={e => setItemSearchAndResetPage(e.target.value)}
                  placeholder="Search item name…"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={`${itemSort.key}-${itemSort.dir}`}
                  onChange={e => {
                    const [key, dir] = e.target.value.split('-')
                    setItemSortAndResetPage({ key, dir })
                  }}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="date-desc">Date (newest)</option>
                  <option value="date-asc">Date (oldest)</option>
                  <option value="amount-desc">Amount Paid (high-low)</option>
                  <option value="amount-asc">Amount Paid (low-high)</option>
                  <option value="name-asc">Item Name (A-Z)</option>
                </select>
              </div>

              {itemDetailRows.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No items match these filters.</p>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th
                            onClick={() => toggleItemSort('date', 'desc')}
                            className="cursor-pointer text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide select-none whitespace-nowrap"
                          >
                            Date {itemSort.key === 'date' && (itemSort.dir === 'asc' ? '▲' : '▼')}
                          </th>
                          <th
                            onClick={() => toggleItemSort('name', 'asc')}
                            className="cursor-pointer text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide select-none whitespace-nowrap"
                          >
                            Item Name {itemSort.key === 'name' && (itemSort.dir === 'asc' ? '▲' : '▼')}
                          </th>
                          <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
                          <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Qty Ordered</th>
                          <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Unit</th>
                          <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Price/Unit (₹)</th>
                          <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Pre-Tax (₹)</th>
                          <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide">GST%</th>
                          <th
                            onClick={() => toggleItemSort('amount', 'desc')}
                            className="cursor-pointer text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide select-none whitespace-nowrap"
                          >
                            Amount Paid (₹) {itemSort.key === 'amount' && (itemSort.dir === 'asc' ? '▲' : '▼')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemPageRows.map(item => {
                          const { base, paid } = itemAmounts(item)
                          return (
                            <tr key={item.id} className="border-b border-gray-100 text-gray-900 hover:bg-gray-50">
                              <td className="py-2 px-2 whitespace-nowrap">{fmtDate(item.date)}</td>
                              <td className="py-2 px-2">{item.item_name}</td>
                              <td className="py-2 px-2">
                                <span className="flex items-center gap-2"><CategoryDot name={item._catName} />{item._catName}</span>
                              </td>
                              <td className="py-2 px-2 text-right">{item.quantity_ordered}</td>
                              <td className="py-2 px-2">{item.unit}</td>
                              <td className="py-2 px-2 text-right">
                                {Number(item.price_per_unit ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 px-2 text-right">{fmtCurrency(base)}</td>
                              <td className="py-2 px-2 text-right">{Number(item.gst_percent ?? 0)}%</td>
                              <td className="py-2 px-2 text-right font-medium">{fmtCurrency(paid)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="md:hidden space-y-3">
                    {itemPageRows.map(item => {
                      const { base, paid } = itemAmounts(item)
                      return (
                        <div key={item.id} className="border border-gray-100 rounded-lg p-3">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-bold text-gray-900 truncate">{item.item_name}</span>
                            <CategoryDot name={item._catName} />
                          </div>
                          <p className="text-xs text-gray-400 mb-1">{fmtDate(item.date)} · {item.quantity_ordered} {item.unit}</p>
                          <p className="text-sm text-gray-700">
                            Pre-Tax: {fmtCurrency(base)} · GST {Number(item.gst_percent ?? 0)}% ·{' '}
                            <span className="font-bold text-gray-900">Paid: {fmtCurrency(paid)}</span>
                          </p>
                        </div>
                      )
                    })}
                  </div>

                  {/* Pagination */}
                  <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-gray-100 text-sm">
                    <span className="text-gray-500">
                      Showing {(itemPageClamped - 1) * ITEMS_PER_PAGE + 1}–{Math.min(itemPageClamped * ITEMS_PER_PAGE, itemDetailRows.length)} of {itemDetailRows.length} items
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setItemPage(p => Math.max(1, p - 1))}
                        disabled={itemPageClamped <= 1}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                      >
                        ← Previous
                      </button>
                      <button
                        onClick={() => setItemPage(p => Math.min(itemTotalPages, p + 1))}
                        disabled={itemPageClamped >= itemTotalPages}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── Divider ── */}
        <div className="border-t border-gray-200 mb-6" />

        {/* ── Category Mapper toggle ── */}
        <button
          onClick={() => setMapperOpen(o => !o)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg px-4 py-2.5 hover:bg-gray-50 transition-colors mb-5"
        >
          ⚙ Manage Categories
          <svg
            className={`w-4 h-4 transition-transform ${mapperOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            />
          </svg>
        </button>

        {mapperOpen && (
          <CategoryMapper
            categories={categories}
            onCategoriesChange={newCats => {
              // CategoryMapper only ever reports kitchen category additions —
              // apply them whenever kitchen categories are part of the current view
              if (scope === 'kitchen' || scope === 'all') {
                setCategories(newCats)
                setSelectedCats(new Set(catNamesForScope(scope, newCats, hkCategories)))
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
