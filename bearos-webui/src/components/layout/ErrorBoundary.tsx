/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import i18n from '@/i18n';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && !Object.is(prevProps.resetKey, this.props.resetKey)) {
      this.handleReset();
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div role="alert" className="flex flex-col items-center justify-center gap-4 p-8">
          <div className="text-destructive text-lg font-semibold">
            {i18n.t('errorBoundary.title', 'Something went wrong')}
          </div>
          <p className="text-muted-foreground text-sm max-w-md text-center">
            {this.state.error?.message ?? i18n.t('errors.unexpectedError', 'An unexpected error occurred.')}
          </p>
          <Button variant="outline" onClick={this.handleReset}>
            {i18n.t('errorBoundary.tryAgain', 'Try Again')}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
