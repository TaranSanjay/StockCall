import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../shared/Navbar'
import CategoryMapper from './CategoryMapper'

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
    const [y, m, day] = key.split('-')
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

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm max-w-xs">
      <p className="font-semibold text-gray-800 mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600 flex-1">{p.dataKey}:</span>
          <span className="font-medium text-gray-900">{fmtCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}


export default function ExpenditureDashboard() {
  const { profile, signOut } = useAuth()

  const [dept, setDept]                 = useState('kitchen')
  const [dateFrom, setDateFrom]         = useState(defaultFrom)
  const [dateTo, setDateTo]             = useState(defaultTo)
  const [granularity, setGranularity]   = useState('weekly')
  const [categories, setCategories]     = useState([])
  const [selectedCats, setSelectedCats] = useState(new Set())

  const [rawItems, setRawItems]         = useState([])
  const [orderDateMap, setOrderDateMap] = useState({})
  const [fetching, setFetching]         = useState(true)
  const [fetchError, setFetchError]     = useState(null)

  const [chartData, setChartData]       = useState([])
  const [summary, setSummary]           = useState({ preTax: 0, tax: 0, grand: 0 })
  const [mapperOpen, setMapperOpen]     = useState(false)

  useEffect(() => { document.title = 'Expenditure Dashboard · Stock Call' }, [])

  // Fetch categories whenever dept changes
  useEffect(() => {
    const table = dept === 'kitchen' ? 'categories' : 'hk_categories'
    supabase
      .from(table)
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        const cats = data ?? []
        setCategories(cats)
        setSelectedCats(new Set([...cats.map(c => c.name), 'Uncategorised']))
      })
  }, [dept])

  // Fetch raw order_items when date range or dept changes
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
          .select('id, placed_at, request_id')
          .gte('placed_at', fromISO)
          .lte('placed_at', toISO)
        if (ordErr) throw ordErr

        if (!allOrders?.length) {
          if (!cancelled) { setRawItems([]); setOrderDateMap({}) }
          return
        }

        // Step 2: fetch requests for department filter
        const reqIds = [...new Set(allOrders.map(o => o.request_id).filter(Boolean))]
        const { data: reqs, error: reqErr } = await supabase
          .from('requests').select('id, department').in('id', reqIds)
        if (reqErr) throw reqErr

        const filteredReqIds = new Set(
          (reqs ?? [])
            .filter(r => dept === 'kitchen'
              ? (r.department === 'kitchen' || !r.department)
              : r.department === 'housekeeping'
            )
            .map(r => r.id)
        )

        const filteredOrders = allOrders.filter(o => filteredReqIds.has(o.request_id))

        if (!filteredOrders.length) {
          if (!cancelled) { setRawItems([]); setOrderDateMap({}) }
          return
        }

        const orderIds = filteredOrders.map(o => o.id)
        const dateMap  = Object.fromEntries(filteredOrders.map(o => [o.id, o.placed_at]))

        // Step 3: fetch order_items (flat — no joins)
        const { data: orderItems, error: itmErr } = await supabase
          .from('order_items')
          .select('id, order_id, item_name, total_price, gst_percent')
          .in('order_id', orderIds)
        if (itmErr) throw itmErr

        if (!orderItems?.length) {
          if (!cancelled) { setRawItems([]); setOrderDateMap(dateMap) }
          return
        }

        // Step 4: name → checklist item id
        const checklistTable = dept === 'kitchen' ? 'checklist_items' : 'housekeeping_checklist_items'
        const { data: checklistItems } = await supabase
          .from(checklistTable).select('id, item_name')

        const nameToId = new Map(
          (checklistItems ?? []).map(ci => [ci.item_name.toLowerCase().trim(), ci.id])
        )

        // Step 5: checklist item id → category id
        const junctionTable = dept === 'kitchen' ? 'item_categories' : 'hk_item_categories'
        const { data: itemCats } = await supabase
          .from(junctionTable).select('checklist_item_id, category_id')

        const idToCatId = new Map(
          (itemCats ?? []).map(ic => [ic.checklist_item_id, ic.category_id])
        )

        // Step 6: category id → category name
        const catTable = dept === 'kitchen' ? 'categories' : 'hk_categories'
        const { data: catRows } = await supabase.from(catTable).select('id, name')

        const catIdToName = new Map(
          (catRows ?? []).map(c => [c.id, c.name])
        )

        // Step 7: enrich each order_item with its resolved category name
        const assembled = orderItems.map(oi => {
          const checklistId = nameToId.get(oi.item_name?.toLowerCase().trim() ?? '')
          const catId       = checklistId ? idToCatId.get(checklistId) : null
          return { ...oi, _catName: catId ? (catIdToName.get(catId) ?? 'Uncategorised') : 'Uncategorised' }
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
  }, [dateFrom, dateTo, dept])

  // Process chart data whenever raw items, granularity, selection, or dept change
  useEffect(() => {
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
    setChartData(sortedKeys.map(key => ({
      period: formatBucketLabel(key, granularity),
      ...buckets[key],
    })))
    setSummary({ preTax, tax, grand: preTax + tax })
  }, [rawItems, orderDateMap, granularity, selectedCats, dept])

  const allCats = [...categories.map(c => c.name), 'Uncategorised']
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

  const manyBuckets = chartData.length > 8

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />

      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Expenditure Dashboard</h1>

        {/* Department toggle */}
        <div className="flex bg-gray-100 p-1 rounded-xl mb-5 max-w-xs">
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

        {/* ── Controls ── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5 space-y-4">

          {/* Date range + granularity */}
          <div className="flex flex-wrap gap-3 items-end">
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
            <div className="w-full h-80 md:h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 20, left: 10, bottom: manyBuckets ? 45 : 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    angle={manyBuckets ? -35 : 0}
                    textAnchor={manyBuckets ? 'end' : 'middle'}
                    interval={manyBuckets ? 0 : 'preserveStartEnd'}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickFormatter={v =>
                      v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
                    }
                    width={55}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: '12px', paddingTop: manyBuckets ? '24px' : '4px' }}
                  />
                  {chartLines.map(cat => (
                    <Line
                      key={cat}
                      type="monotone"
                      dataKey={cat}
                      stroke={CATEGORY_COLORS[cat] ?? FALLBACK_COLOR}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
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
              // Only apply kitchen category updates when in kitchen mode
              if (dept === 'kitchen') {
                setCategories(newCats)
                setSelectedCats(new Set([...newCats.map(c => c.name), 'Uncategorised']))
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
