export const PURPOSE_OPTIONS = [
  { value: 'kitchen',                  label: 'Kitchen' },
  { value: '89xquisit_housekeeping',   label: '89Xquisit Housekeeping' },
  { value: 'atlantis_housekeeping',    label: 'Atlantis Housekeeping' },
  { value: 'coffeeboard_housekeeping', label: 'Coffee Board Housekeeping' },
]

export const PURPOSE_LABELS = Object.fromEntries(PURPOSE_OPTIONS.map(p => [p.value, p.label]))

export function departmentForPurpose(purpose) {
  return purpose === 'kitchen' ? 'kitchen' : 'housekeeping'
}
