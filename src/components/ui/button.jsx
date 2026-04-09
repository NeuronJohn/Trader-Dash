import React from 'react'
import { cn } from '@/lib/utils'

const Button = React.forwardRef(({ className, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn('inline-flex items-center justify-center whitespace-nowrap text-sm font-medium', className)} {...props} />
))
Button.displayName = 'Button'

export { Button }
