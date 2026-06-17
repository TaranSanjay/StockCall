import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewRequestForm from './components/chef/NewRequestForm'
import ConfirmReceipt from './components/chef/ConfirmReceipt'
import RequestReview from './components/manager/RequestReview'
import PlaceOrder from './components/manager/PlaceOrder'
import SupplyToKitchen from './components/manager/SupplyToKitchen'
import OrdersQueue from './components/manager/OrdersQueue'
import NewItemsQueue from './components/manager/NewItemsQueue'
import LogsView from './components/shared/LogsView'
import ExpenditureDashboard from './components/dashboard/ExpenditureDashboard'

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return user ? children : <Navigate to="/login" replace />
}

function ManagerRoute({ children }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (profile?.role === 'chef') return <Navigate to="/dashboard" replace />
  return children
}

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return <Navigate to={user ? '/dashboard' : '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                              element={<RootRedirect />} />
        <Route path="/login"                         element={<Login />} />
        <Route path="/dashboard"                     element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/requests/new"                  element={<ProtectedRoute><NewRequestForm /></ProtectedRoute>} />
        <Route path="/requests/confirm/:requestId"   element={<ProtectedRoute><ConfirmReceipt /></ProtectedRoute>} />
        <Route path="/requests/:requestId/review"    element={<ManagerRoute><RequestReview /></ManagerRoute>} />
        <Route path="/requests/:requestId/order"     element={<ManagerRoute><PlaceOrder /></ManagerRoute>} />
        <Route path="/requests/:requestId/supply"    element={<ManagerRoute><SupplyToKitchen /></ManagerRoute>} />
        <Route path="/orders"                        element={<ManagerRoute><OrdersQueue /></ManagerRoute>} />
        <Route path="/logs"                          element={<ManagerRoute><LogsView /></ManagerRoute>} />
        <Route path="/new-items"                     element={<ManagerRoute><NewItemsQueue /></ManagerRoute>} />
        <Route path="/dashboard/expenditure"         element={<ManagerRoute><ExpenditureDashboard /></ManagerRoute>} />
        <Route path="*"                              element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
