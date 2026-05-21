console.log("Environment Keys:", Object.keys(process.env).filter(k => !k.includes("KEY") && !k.includes("SECRET")));
console.log("Has SUPABASE_SERVICE_ROLE_KEY:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("Has VITE_SUPABASE_URL:", !!process.env.VITE_SUPABASE_URL);
console.log("Has VITE_SUPABASE_ANON_KEY:", !!process.env.VITE_SUPABASE_ANON_KEY);
console.log("SUPABASE_SERVICE_ROLE_KEY value preview:", process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.slice(0, 10) + "..." : "undefined");
