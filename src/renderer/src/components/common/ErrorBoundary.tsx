import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-bg p-8">
          <div className="max-w-lg w-full bg-surface border border-border rounded-lg overflow-hidden">
            {/* Red accent header */}
            <div className="bg-accent-red/20 border-b border-accent-red/40 px-6 py-4">
              <h1 className="text-accent-red text-lg font-semibold">
                Something went wrong
              </h1>
            </div>

            {/* Error details */}
            <div className="p-6 space-y-4">
              <p className="text-text-secondary text-sm">
                An unexpected error occurred. You can try reloading the application.
              </p>

              {this.state.error && (
                <div className="bg-elevated border border-border rounded-md p-4 overflow-auto max-h-48">
                  <pre className="text-accent-red font-mono text-xs whitespace-pre-wrap break-words">
                    {this.state.error.message}
                  </pre>
                  {this.state.error.stack && (
                    <pre className="text-text-muted font-mono text-xs mt-2 whitespace-pre-wrap break-words">
                      {this.state.error.stack}
                    </pre>
                  )}
                </div>
              )}

              <button
                onClick={this.handleReload}
                className="w-full px-4 py-2.5 bg-accent-red/20 hover:bg-accent-red/30 text-accent-red border border-accent-red/40 rounded-md text-sm font-medium transition-colors cursor-pointer"
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
