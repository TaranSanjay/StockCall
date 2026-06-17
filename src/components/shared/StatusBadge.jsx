const STATUS_STYLES = {
  // request / item statuses
  draft:        'bg-gray-100 text-gray-700',
  submitted:    'bg-blue-100 text-blue-700',
  under_review: 'bg-amber-100 text-amber-700',
  closed:       'bg-green-100 text-green-700',
  cancelled:    'bg-red-100 text-red-700',
  approved:     'bg-green-100 text-green-700',
  rejected:     'bg-red-100 text-red-700',
  pending:      'bg-amber-100 text-amber-700',
  // roles
  admin:        'bg-purple-100 text-purple-700',
  supermanager: 'bg-indigo-100 text-indigo-700',
  manager:      'bg-blue-100 text-blue-700',
  chef:         'bg-orange-100 text-orange-700',
}

const STATUS_LABELS = {
  draft:        'Draft',
  submitted:    'Submitted',
  under_review: 'Under Review',
  closed:       'Closed',
  cancelled:    'Cancelled',
  approved:     'Approved',
  rejected:     'Rejected',
  pending:      'Pending',
  admin:        'Admin',
  supermanager: 'Supermanager',
  manager:      'Manager',
  chef:         'Chef',
}

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'
  const label = STATUS_LABELS[status] ?? status

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {label}
    </span>
  )
}
