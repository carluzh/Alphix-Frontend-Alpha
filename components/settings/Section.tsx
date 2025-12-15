export const Section = ({
  id,
  children,
}: {
  id?: string
  children: React.ReactNode
}) => {
  return (
    <div className="relative flex flex-col gap-4" id={id}>
      {children}
    </div>
  )
}

export const SectionDescription = ({
  title,
  description,
}: {
  title: string
  description?: string
}) => {
  return (
    <div className="flex w-full flex-col gap-1">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      )}
    </div>
  )
}
