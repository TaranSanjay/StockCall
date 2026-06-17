import { useEffect } from 'react'

export default function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])

  const bg = type === 'success' ? 'bg-green-600' : 'bg-red-600'

  return (
    <div
      className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 ${bg} text-white rounded-xl px-4 py-3.5 shadow-lg flex items-center justify-between gap-3`}
      role="alert"
    >
      <span className="text-base font-medium">{message}</span>
      <button
        onClick={onClose}
        className="text-white/80 hover:text-white flex-shrink-0 text-xl leading-none w-8 h-8 flex items-center justify-center"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
