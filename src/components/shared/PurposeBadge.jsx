const PURPOSE_STYLES = {
  kitchen:                  { cls: 'bg-orange-100 text-orange-700', emoji: '🍳', label: 'Kitchen' },
  '89xquisit_housekeeping':   { cls: 'bg-teal-100 text-teal-700',   emoji: '🧹', label: '89Xquisit HK' },
  atlantis_housekeeping:      { cls: 'bg-blue-100 text-blue-700',   emoji: '🧹', label: 'Atlantis HK' },
  coffeeboard_housekeeping:   { cls: 'bg-amber-100 text-amber-700', emoji: '☕', label: 'Coffee Board HK' },
}

export default function PurposeBadge({ purpose }) {
  const style = PURPOSE_STYLES[purpose]
  if (!style) return null
  return (
    <span className={`${style.cls} text-xs rounded-full px-2 py-0.5 whitespace-nowrap`}>
      {style.emoji} {style.label}
    </span>
  )
}
