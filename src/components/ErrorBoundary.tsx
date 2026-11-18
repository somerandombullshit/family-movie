import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Something unexpected happened.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F7F6F2] text-[#141413] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#E4E2DC] rounded-2xl p-8 space-y-5">
            <h1 className="text-2xl font-bold text-[#141413]">
              Unable to load movies right now
            </h1>
            <p className="text-lg text-[#52504B] leading-relaxed">
              Please reload this page to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[56px] px-6 py-3 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/40"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
