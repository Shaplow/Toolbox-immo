import { PropsWithChildren, ReactNode } from 'react'

type CardProps = PropsWithChildren<{
  title: string
  subtitle?: string
  icon?: ReactNode
}>

export default function CaptionsCard({ title, subtitle, icon, children }: CardProps) {
  return (
    <section className="cx-card">
      <div className="cx-card-head">
        {icon && <div className="cx-card-head-icon">{icon}</div>}
        <div className="cx-card-head-text">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="cx-card-body">{children}</div>
    </section>
  )
}
