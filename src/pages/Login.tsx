import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn, AlertCircle, Mail, Lock } from 'lucide-react';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { useAuthStore } from '../store/useAuthStore';

export function Login() {
  const navigate = useNavigate();
  const { user, profile, loading, signIn, signInWithGoogle } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!loading && user) {
      navigate('/workspace-select?fromLogin=true');
    }
  }, [user, loading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setError(null);
    setIsLoggingIn(true);
    try {
      await signIn(email, password);
    } catch (err: any) {
      console.error("Authentication failed:", err);
      setError(err.message || "Invalid credentials.");
      setIsLoggingIn(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) {
      setError("No Google credential received.");
      return;
    }

    setError(null);
    setIsLoggingIn(true);
    try {
      await signInWithGoogle(credentialResponse.credential);
    } catch (err: any) {
      console.error("Google login failed:", err);
      setError(err.message || "Google login failed.");
      setIsLoggingIn(false);
    }
  };

  const handleGoogleError = () => {
    setError("Google Sign-In failed.");
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-gray-50 flex flex-col items-center text-center max-w-sm w-full mx-4">
        <div className="w-20 h-20 bg-orange-50 rounded-[2rem] flex items-center justify-center mb-8 rotate-12">
          <LogIn size={40} className="text-orange-600 -rotate-12" />
        </div>
        <h1 className="text-4xl font-black text-gray-900 tracking-tighter mb-4">Staff Portal</h1>
        <p className="text-gray-500 font-medium mb-8">Login to your dashboard</p>

        <form onSubmit={handleLogin} className="w-full space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-orange-500 focus:bg-white rounded-2xl outline-none transition-all font-medium text-sm"
              required
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-orange-500 focus:bg-white rounded-2xl outline-none transition-all font-medium text-sm"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoggingIn || loading}
            className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black text-lg shadow-lg shadow-orange-200 hover:bg-orange-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none mt-2"
          >
            {isLoggingIn ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="w-full flex items-center gap-4 my-6">
          <div className="h-[1px] bg-gray-100 flex-1"></div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Or continue with</span>
          <div className="h-[1px] bg-gray-100 flex-1"></div>
        </div>

        <div className="w-full flex justify-center scale-110 mb-4 h-12">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={handleGoogleError}
            theme="outline"
            shape="pill"
            width="full"
          />
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 text-red-600 text-[10px] font-bold rounded-2xl border border-red-100 flex items-center gap-2 text-left w-full">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
            <p className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">
                Don't have an account?
            </p>
            <Link to="/register" className="text-orange-600 font-black text-xs hover:underline decoration-2 underline-offset-4">
                CREATE ONE NOW
            </Link>
        </div>
        
        <p className="mt-8 text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-relaxed">
          Secure JWT Authentication
        </p>
      </div>
    </div>
  );
}

