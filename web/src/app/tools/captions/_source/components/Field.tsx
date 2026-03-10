import { PropsWithChildren } from 'react'

type FieldProps = PropsWithChildren<{
  label: string
  value?: string | number
}>

export function Field({ label, value, children }: FieldProps) {
  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label">{label}</span>
        {value !== undefined && <span className="field-val">{value}</span>}
      </div>
      {children}
    </div>
  )
}
