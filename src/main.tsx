import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {GoogleOAuthProvider} from '@react-oauth/google';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { logger } from './lib/logger';
import './index.css';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function Root() {
  const oauthClientId = googleClientId || '768393019310-dummy.apps.googleusercontent.com';
  return (
    <StrictMode>
      <ErrorBoundary>
        <GoogleOAuthProvider clientId={oauthClientId}>
          <App />
        </GoogleOAuthProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
