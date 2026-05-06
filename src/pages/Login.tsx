import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogIn, AlertCircle } from 'lucide-react';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { useAuthStore } from '../store/useAuthStore';

export function Login() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      if (profile?.restaurantId) {
        navigate(`/restaurant/${profile.restaurantId}/orders`);
      } else {
        navigate('/onboarding');
      }
    }
  }, [user, profile, loading, navigate]);

  const isSupabaseMissing = import.meta.env.VITE_SUPABASE_URL?.includes('missing-project-id') || !import.meta.env.VITE_SUPABASE_URL;
  const isGoogleMissing = !import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID === "";

  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) {
      setError("No credential received from Google.");
      return;
    }

    setError(null);
    setIsLoggingIn(true);
    try {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: credentialResponse.credential,
      });

      if (error) throw error;
      
    } catch (err: any) {
      console.error("Supabase authentication failed:", err);
      setError(err.message || "Failed to sync Google account with portal.");
      setIsLoggingIn(false);
    }
  };

  const handleGoogleError = () => {
    setError("Google Sign-In failed. Please try again.");
  };

  const isConfigMissing = isSupabaseMissing || isGoogleMissing;

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-gray-50 flex flex-col items-center text-center max-w-sm w-full mx-4">
        <div className="w-20 h-20 bg-orange-50 rounded-[2rem] flex items-center justify-center mb-8 rotate-12">
          <LogIn size={40} className="text-orange-600 -rotate-12" />
        </div>
        <h1 className="text-4xl font-black text-gray-900 tracking-tighter mb-4">Staff Portal</h1>
        <p className="text-gray-500 font-medium mb-6">Access your restaurant management dashboard</p>

        {isConfigMissing && (
          <div className="mb-8 p-6 bg-red-50 border-2 border-red-100 rounded-3xl text-left w-full">
            <div className="flex items-center gap-2 text-red-800 font-bold mb-3">
              <AlertCircle size={20} />
              <h3>Setup Required</h3>
            </div>
            <p className="text-red-700 text-[10px] leading-relaxed font-medium mb-4">
              To use Google Auth, add these variables in <strong>Settings (Gear icon)</strong>:
            </p>
            <ul className="text-[10px] space-y-2 text-red-600 font-mono bg-white/50 p-3 rounded-xl border border-red-100">
              <li className="flex justify-between">
                <span>VITE_SUPABASE_URL</span>
                <span>{isSupabaseMissing ? '❌ Missing' : '✅ Set'}</span>
              </li>
              <li className="flex justify-between">
                <span>VITE_SUPABASE_ANON_KEY</span>
                <span>{isSupabaseMissing ? '❌ Missing' : '✅ Set'}</span>
              </li>
              <li className="flex justify-between">
                <span>VITE_GOOGLE_CLIENT_ID</span>
                <span>{isGoogleMissing ? '❌ Missing' : '✅ Set'}</span>
              </li>
            </ul>
          </div>
        )}
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 text-xs font-bold rounded-2xl border border-red-100 w-full">
            {error}
          </div>
        )}
        
        <div className="w-full flex justify-center py-2">
          {!isConfigMissing ? (
            <div className="scale-125 origin-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={handleGoogleError}
                useOneTap
                theme="outline"
                shape="pill"
                size="large"
                width="250"
              />
            </div>
          ) : (
            <div className="w-full bg-gray-100 text-gray-400 py-4 rounded-[2rem] font-bold">
              Waiting for Configuration...
            </div>
          )}
        </div>
        
        <p className="mt-12 text-xs text-gray-400 font-bold uppercase tracking-widest leading-relaxed">
          Powered by Supabase & Google
        </p>
      </div>
    </div>
  );
}
