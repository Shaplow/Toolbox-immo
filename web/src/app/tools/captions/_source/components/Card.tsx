import { PropsWithChildren, ReactNode } from 'react'

type CardProps = PropsWithChildren<{
  title: string
  subtitle?: string
  icon?: ReactNode
}>

export default function Card({ title, subtitle, icon, children }: CardProps) {
  return (
    <section className="card">
      <div className="card-head">
        {icon && <div className="card-head-icon">{icon}</div>}
        <div className="card-head-text">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}
