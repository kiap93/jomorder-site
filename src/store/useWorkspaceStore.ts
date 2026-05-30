import { create } from 'zustand';
import { Organization, WorkspaceRestaurant } from '../types';
import { getApiUrl } from '../lib/api';

interface WorkspaceState {
  organizations: Organization[];
  restaurants: WorkspaceRestaurant[];
  loading: boolean;
  hasFetched: boolean;
  fetchWorkspaces: (token: string, force?: boolean) => Promise<void>;
  clearWorkspaces: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  organizations: [],
  restaurants: [],
  loading: false,
  hasFetched: false,
  fetchWorkspaces: async (token: string, force = false) => {
    if (!token) return;
    if (get().hasFetched && !force) return;

    set({ loading: true });
    try {
      const res = await fetch(getApiUrl('/api/my-workspaces'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        set({
          organizations: data.organizations || [],
          restaurants: data.restaurants || [],
          hasFetched: true
        });
      }
    } catch (err) {
      console.error("Failed to load organizations in workspaceStore:", err);
    } finally {
      set({ loading: false });
    }
  },
  clearWorkspaces: () => {
    set({
      organizations: [],
      restaurants: [],
      hasFetched: false,
      loading: false
    });
  }
}));
