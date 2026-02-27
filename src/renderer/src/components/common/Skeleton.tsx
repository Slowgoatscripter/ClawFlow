interface SkeletonProps {
  width?: string
  height?: string
  className?: string
  rounded?: boolean
}

export function Skeleton({
  width = '100%',
  height = '1rem',
  className = '',
  rounded = false
}: SkeletonProps) {
  return (
    <div
      className={`bg-elevated/50 animate-pulse ${rounded ? 'rounded-full' : 'rounded'} ${className}`}
      style={{ width, height }}
    />
  )
}
