import React, { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-center">
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl max-w-lg w-full border border-red-100">
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-3xl flex items-center justify-center mx-auto mb-8 animate-pulse">
              <AlertCircle size={40} />
            </div>
            <h1 className="text-3xl font-black text-gray-900 mb-4">Something went wrong</h1>
            <p className="text-gray-500 font-medium mb-8 leading-relaxed">
              The application encountered an unexpected error. Don't worry, your data is likely safe.
            </p>
            {this.state.error && (
              <div className="bg-red-50 p-4 rounded-2xl mb-8 text-left overflow-auto max-h-40">
                <code className="text-xs text-red-700 font-mono break-all font-bold">
                  {this.state.error.toString()}
                </code>
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-3 bg-gray-900 text-white py-5 rounded-2xl font-black hover:bg-black transition-all shadow-xl hover:shadow-2xl active:scale-95"
            >
              <RefreshCw size={20} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
