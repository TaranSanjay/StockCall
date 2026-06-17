import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import StatusBadge from './StatusBadge'
import StockCallLogo from './StockCallLogo'

export default function Navbar({ profile, onSignOut }) {
  const [menuOpen, setMenuOpen]                         = useState(false)
  const [pendingCount, setPendingCount]                 = useState(0)
  const [pendingOrdersCount, setPendingOrdersCount]     = useState(0)
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0)
  const isManager = ['manager', 'supermanager', 'admin'].includes(profile?.role)
  const location  = useLocation()
  const menuRef   = useRef(null)

  // Badge counts — re-fetch on every route change
  useEffect(() => {
    if (!isManager) return

    if (profile?.username === 'taran') {
      supabase
        .from('pending_checklist_items')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(({ count }) => setPendingCount(count ?? 0))
    }

    supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .in('status', ['submitted', 'under_review'])
      .then(({ count }) => setPendingRequestsCount(count ?? 0))

    async function fetchPendingOrders() {
      const { data: closedReqs } = await supabase
        .from('requests')
        .select('id, request_items(item_status)')
        .eq('status', 'closed')
        .limit(200)
      if (!closedReqs?.length) { setPendingOrdersCount(0); return }

      const relevantIds = closedReqs
        .filter(r => (r.request_items ?? []).some(i => i.item_status === 'approved'))
        .map(r => r.id)
      if (!relevantIds.length) { setPendingOrdersCount(0); return }

      const { data: orders } = await supabase
        .from('orders')
        .select('request_id')
        .in('request_id', relevantIds)
      const orderedIds = new Set((orders ?? []).map(o => o.request_id))
      setPendingOrdersCount(relevantIds.filter(id => !orderedIds.has(id)).length)
    }
    fetchPendingOrders()
  }, [isManager, profile?.username, location.pathname])

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // Close on click outside
  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [menuOpen])

  const close = () => setMenuOpen(false)

  const menuLinkClass = ({ isActive }) =>
    `text-sm flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
      isActive ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700 hover:bg-gray-100'
    }`

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="px-4 flex items-center h-14 gap-3">

        {/* Left: hamburger + logo + dropdown (anchored here for click-outside) */}
        <div className="flex items-center gap-3" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="p-2 rounded-lg hover:bg-gray-100 cursor-pointer"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <NavLink to="/dashboard" className="flex items-center" onClick={close}>
            <StockCallLogo height={32} />
          </NavLink>

          {/* Dropdown panel */}
          {menuOpen && (
            <div className="absolute top-14 left-2 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3">

              {/* User info — always visible */}
              {profile && (
                <div className="px-1 py-1">
                  <p className="text-base font-semibold text-gray-900">{profile.full_name}</p>
                  <div className="mt-1.5">
                    <StatusBadge status={profile.role} />
                  </div>
                  {profile.username && (
                    <p className="text-xs text-gray-500 mt-1.5">@{profile.username}</p>
                  )}
                </div>
              )}
              <div className="border-b border-gray-200 my-3" />

              {/* Mobile only: nav links */}
              <div className="md:hidden space-y-0.5">
                <NavLink to="/dashboard" end onClick={close} className={menuLinkClass}>
                  <span>📋</span> Requests
                </NavLink>
                {isManager && (
                  <>
                    <NavLink to="/orders" onClick={close} className={menuLinkClass}>
                      <span>📦</span> Orders
                      {pendingOrdersCount > 0 && (
                        <span className="ml-auto w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                          {pendingOrdersCount > 9 ? '9+' : pendingOrdersCount}
                        </span>
                      )}
                    </NavLink>
                    <NavLink to="/logs" onClick={close} className={menuLinkClass}>
                      <span>📄</span> Logs
                    </NavLink>
                    {profile?.username === 'taran' && (
                      <NavLink to="/new-items" onClick={close} className={menuLinkClass}>
                        <span>✨</span> New Items
                        {pendingCount > 0 && (
                          <span className="ml-auto w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                            {pendingCount > 9 ? '9+' : pendingCount}
                          </span>
                        )}
                      </NavLink>
                    )}
                    {(profile?.role === 'supermanager' || profile?.role === 'admin') && (
                      <NavLink to="/dashboard/expenditure" onClick={close} className={menuLinkClass}>
                        <span>📊</span> Expenditure
                      </NavLink>
                    )}
                  </>
                )}
              </div>
              <div className="md:hidden border-b border-gray-200 my-3" />

              {/* Sign out — always visible */}
              <button
                onClick={() => { close(); onSignOut() }}
                className="text-sm text-red-600 hover:bg-red-50 rounded-lg px-3 py-2 flex items-center gap-2 w-full text-left transition-colors"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>

        {/* Right: desktop nav links (md and above, managers only) */}
        {isManager && (
          <div className="ml-auto hidden md:flex items-center gap-1">
            <NavLink
              to="/dashboard"
              end
              className={({ isActive }) =>
                `text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                  isActive
                    ? 'text-blue-600 font-medium bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              Requests
              {pendingRequestsCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                  {pendingRequestsCount > 9 ? '9+' : pendingRequestsCount}
                </span>
              )}
            </NavLink>
            <NavLink
              to="/orders"
              className={({ isActive }) =>
                `text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                  isActive
                    ? 'text-blue-600 font-medium bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              Orders
              {pendingOrdersCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                  {pendingOrdersCount > 9 ? '9+' : pendingOrdersCount}
                </span>
              )}
            </NavLink>
            <NavLink
              to="/logs"
              className={({ isActive }) =>
                `text-sm px-3 py-1.5 rounded-lg flex items-center transition-colors ${
                  isActive
                    ? 'text-blue-600 font-medium bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              Logs
            </NavLink>
            {profile?.username === 'taran' && (
              <NavLink
                to="/new-items"
                className={({ isActive }) =>
                  `text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                    isActive
                      ? 'text-blue-600 font-medium bg-blue-50'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`
                }
              >
                New Items
                {pendingCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </NavLink>
            )}
            {(profile?.role === 'supermanager' || profile?.role === 'admin') && (
              <NavLink
                to="/dashboard/expenditure"
                className={({ isActive }) =>
                  `text-sm px-3 py-1.5 rounded-lg flex items-center transition-colors ${
                    isActive
                      ? 'text-blue-600 font-medium bg-blue-50'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`
                }
              >
                Expenditure
              </NavLink>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}
