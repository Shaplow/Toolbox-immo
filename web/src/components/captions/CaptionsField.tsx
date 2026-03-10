import { PropsWithChildren } from 'react'

type FieldProps = PropsWithChildren<{
  label: string
  value?: string | number
}>

export function CaptionsField({ label, value, children }: FieldProps) {
  return (
    <div className="cx-field">
      <div className="cx-field-row">
        <span className="cx-field-label">{label}</span>
        {value !== undefined && <span className="cx-field-val">{value}</span>}
      </div>
      {children}
    </div>
  )
}
