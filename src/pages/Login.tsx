import { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';

export function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setIsLoggingIn(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check if user has a profile, if not create a default one
      const userPath = `users/${user.uid}`;
      let profileDoc;
      try {
        profileDoc = await getDoc(doc(db, 'users', user.uid));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, userPath);
      }

      if (!profileDoc.exists()) {
        try {
          await setDoc(doc(db, 'users', user.uid), {
            email: user.email,
            role: 'admin',
            restaurantId: 'default'
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, userPath);
        }
        
        // Ensure default restaurant exists
        const restPath = 'restaurants/default';
        let restDoc;
        try {
          restDoc = await getDoc(doc(db, 'restaurants', 'default'));
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, restPath);
        }

        if (!restDoc.exists()) {
          try {
            await setDoc(doc(db, 'restaurants', 'default'), {
              name: 'Original Malay Delights',
              currency: 'MYR',
              serviceCharge: 6,
              sst: 10
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, restPath);
          }
        }
      }

      navigate('/restaurant/default/orders');
    } catch (err: any) {
      console.error("Login failed:", err);
      if (err.code === 'auth/unauthorized-domain') {
        setError("This domain is not authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.");
      } else if (err.message?.includes('auth/popup-closed-by-user')) {
        setError("Login popup was closed. Please try again.");
      } else {
        try {
          const parsed = JSON.parse(err.message);
          setError(`Permission Error: ${parsed.operationType} on ${parsed.path}`);
        } catch {
          setError("Login failed. " + (err.message || "Please check your connection."));
        }
      }
    } finally {
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
          className="w-full bg-gray-900 text-white py-5 rounded-[2rem] font-bold text-lg hover:bg-black transition-all flex items-center justify-center gap-3 shadow-xl active:scale-95"
        >
          <img src="https://www.gstatic.com/firebase/builtins/pixie/images/grey_g_logo.svg" className="w-6 h-6 bg-white p-1 rounded-full" alt="Google" />
          Continue with Google
        </button>
        
        <p className="mt-8 text-xs text-gray-400 font-bold uppercase tracking-widest leading-relaxed">
          Secured by Google Identity
        </p>
      </div>
    </div>
  );
}
