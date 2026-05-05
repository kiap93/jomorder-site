import { create } from 'zustand';
import { onAuthStateChanged, signOut as firebaseSignOut, User } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { UserProfile } from '../types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  init: () => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  loading: true,
  init: () => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        const profileDoc = await getDoc(doc(db, 'users', user.uid));
        set({ user, profile: profileDoc.data() as UserProfile, loading: false });
      } else {
        set({ user: null, profile: null, loading: false });
      }
    });
  },
  signOut: async () => {
    await firebaseSignOut(auth);
    set({ user: null, profile: null });
  }
}));
