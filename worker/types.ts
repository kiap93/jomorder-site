export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GEMINI_API_KEY: string;
  ADMIN_USER_EMAIL?: string;
  ADMIN_USER_PASSWORD?: string;
  PAYMENT_ENCRYPTION_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_GROWTH?: string;
  STRIPE_PRICE_PRO?: string;
};

export type Variables = {
  user: any;
};

export type RegistryEntry = {
  subscription_plan: string;
  status: string;
  multi_outlet_enabled: boolean;
  max_outlets: number;
  franchise_mode: boolean;
  features: {
    duitnow_payment: boolean;
    partial_payment: boolean;
    kitchen_display: boolean;
    multi_language_menu: boolean;
    socket_realtime: boolean;
  };
  billing_history: {
    date: string;
    description: string;
    amount: number;
    status: 'paid' | 'pending';
  }[];
  api_calls_count: number;
};
