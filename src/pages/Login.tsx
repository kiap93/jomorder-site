import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';

export function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setIsLoggingIn(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/onboarding'
        }
      });
      
      if (error) throw error;
      
      // Note: Supabase OAuth redirects away from the page, 
      // so code after this might not run immediately.
    } catch (err: any) {
      console.error("Login failed:", err);
      setError(err.message || "Login failed. Please check your connection.");
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-gray-50 flex flex-col items-center text-center max-w-sm w-full mx-4">
        <div className="w-20 h-20 bg-orange-50 rounded-[2rem] flex items-center justify-center mb-8 rotate-12">
          <LogIn size={40} className="text-orange-600 -rotate-12" />
        </div>
        <h1 className="text-4xl font-black text-gray-900 tracking-tighter mb-4">Staff Portal</h1>
        <p className="text-gray-500 font-medium mb-6">Access your restaurant management dashboard</p>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 text-xs font-bold rounded-2xl border border-red-100">
            {error}
          </div>
        )}
        
        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          className="w-full bg-gray-900 text-white py-5 rounded-[2rem] font-bold text-lg hover:bg-black transition-all flex items-center justify-center gap-3 shadow-xl active:scale-95 disabled:opacity-50"
        >
          <img src="https://www.gstatic.com/firebase/builtins/pixie/images/grey_g_logo.svg" className="w-6 h-6 bg-white p-1 rounded-full" alt="Google" />
          {isLoggingIn ? 'Redirecting...' : 'Continue with Google'}
        </button>
        
        <p className="mt-8 text-xs text-gray-400 font-bold uppercase tracking-widest leading-relaxed">
          Secured by Supabase Identity
        </p>
      </div>
    </div>
  );
}
