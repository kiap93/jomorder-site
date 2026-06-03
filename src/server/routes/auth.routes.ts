import { Router, Request } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { supabaseAdmin, googleClient, getJwtSecret, getStaffSettings } from "../services/dbService";
import { LoginSchema, RegisterSchema } from "../../lib/validation";
import { authenticateJWT } from "../middleware/authMiddleware";

const router = Router();

// Custom Login - returns a JWT
router.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password } = parsed.data;

  const envAdminEmail = process.env.ADMIN_USER_EMAIL;
  const envAdminPass = process.env.ADMIN_USER_PASSWORD;

  const isAdminEnvMatch = envAdminEmail && email === envAdminEmail && password === envAdminPass;
  const isDevAdminMatch = (email === "admin@saas.com" && password === "admin123") || 
                         (email === "test@example.com" && password === "password123") ||
                         (email && email.toLowerCase() === "kiap93.kmj@gmail.com" && password === "admin123");

  // 1. Check for system admin hardcoded credentials or seed dev fallbacks
  if (isAdminEnvMatch || isDevAdminMatch) {
    let { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (!profile) {
      let authUserId: string | null = null;
      try {
        const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
        const existingAuthUser = usersList?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (existingAuthUser) {
          authUserId = existingAuthUser.id;
        } else {
          const { data: newAuth, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: password || 'admin123',
            email_confirm: true
          });
          if (!createError && newAuth?.user) {
            authUserId = newAuth.user.id;
          }
        }
      } catch (e) {
        console.error("Failed to list or create auth user for express superadmin:", e);
      }

      const idToInsert = authUserId || crypto.randomUUID();

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: idToInsert,
          email: email,
          role: 'admin',
          status: 'active'
        })
        .select()
        .single();
      
      if (!insertError && inserted) {
        profile = inserted;
      } else {
        profile = {
          id: idToInsert,
          email: email,
          role: 'admin',
          status: 'active'
        };
      }
    }

    const enrichedUser = {
      id: profile.id,
      email: profile.email,
      role: profile.role || 'admin',
      platform_role: 'superadmin',
      is_platform_admin: true,
      restaurantId: profile.restaurant_id || null,
      status: 'active',
      permissions: {
        can_refund: true,
        can_edit_menu: true,
        can_cancel_order: true,
        can_view_analytics: true,
        can_manage_staff: true
      }
    };

    const token = jwt.sign(enrichedUser, getJwtSecret(), { expiresIn: '7d' });
    return res.json({ token, user: enrichedUser });
  }

  try {
    // 2. Try to authenticate with Supabase Auth for email/password users
    const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (authData && authData.user) {
      // Authentication successful, now get the profile
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .maybeSingle();
      
      if (profile) {
        const token = jwt.sign({ 
          id: profile.id, 
          email: profile.email, 
          role: profile.role,
          restaurantId: profile.restaurant_id 
        }, getJwtSecret(), { expiresIn: '7d' });
        
        return res.json({ token, user: profile });
      }
    }

    // 3. Fallback for legacy staff accounts or hardcoded "staff123"
    const { data: legacyProfile, error: legacyError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (legacyProfile && (password === 'staff123' || (envAdminPass && password === envAdminPass))) {
      const token = jwt.sign({ 
        id: legacyProfile.id, 
        email: legacyProfile.email, 
        role: legacyProfile.role,
        restaurantId: legacyProfile.restaurant_id 
      }, getJwtSecret(), { expiresIn: '7d' });
      
      return res.json({ token, user: legacyProfile });
    }

    res.status(401).json({ error: "Invalid credentials" });
  } catch (err: any) {
    console.error("Login error:", err);
    res.status(500).json({ error: err.message });
  }
});

// User Registration - creates Supabase account and local profile
router.post("/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password } = parsed.data;

  try {
    // 1. Create user in Supabase Auth using Admin API
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    if (!authUser.user) {
      throw new Error("User creation failed: No user returned");
    }

    // 2. Create the associated profile record 
    // We use service role to ensure bypass of RLS during initial setup
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authUser.user.id,
        email: email,
        role: 'staff', // Default role for new registrations
      })
      .select()
      .single();

    if (profileError) {
      // Attempt cleanup of the auth user if profile record fails
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      throw profileError;
    }

    // 3. Generate our custom JWT for the newly registered user
    const token = jwt.sign({ 
      id: profile.id, 
      email: profile.email, 
      role: profile.role,
      restaurantId: profile.restaurant_id 
    }, getJwtSecret(), { expiresIn: '7d' });

    res.json({ token, user: profile });
  } catch (err: any) {
    console.error("Registration error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Google Login - returns a custom JWT
router.post("/google-login", async (req, res) => {
  const { idToken } = req.body;
  console.log("Google Login request received. idToken length:", idToken?.length);
  
  if (!idToken) {
    console.log("Missing idToken");
    return res.status(400).json({ error: "Missing token" });
  }

  try {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    const audience = GOOGLE_CLIENT_ID;
    if (!audience) {
      console.error("GOOGLE_CLIENT_ID is not configured on the server");
      return res.status(500).json({ error: "Server misconfiguration: Google Client ID not found" });
    }

    console.log("Verifying token with audience:", audience);

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: audience,
    });
    const payload = ticket.getPayload();
    console.log("Payload received for email:", payload?.email);

    if (!payload || !payload.email) {
      console.log("Invalid Google payload or missing email");
      throw new Error("Invalid Google payload");
    }

    const email = payload.email;
    let userPayload: {
      id: string;
      email: string;
      role: string;
      platform_role?: string;
      is_platform_admin?: boolean;
      restaurantId: string | null;
      status?: string;
      permissions?: Record<string, boolean>;
    } | null = null;

    const isSuperAdminEmail = (process.env.ADMIN_USER_EMAIL && email === process.env.ADMIN_USER_EMAIL) || 
                             email === "admin@saas.com" || 
                             email === "test@example.com" || 
                             (email && email.toLowerCase() === "kiap93.kmj@gmail.com");

    if (isSuperAdminEmail) {
      console.log("Admin email match:", email);
      let { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (!profile) {
        let authUserId: string | null = null;
        try {
          const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
          const existingAuthUser = usersList?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
          if (existingAuthUser) {
            authUserId = existingAuthUser.id;
          } else {
            const dummyPassword = crypto.randomUUID();
            const { data: newAuth, error: createError } = await supabaseAdmin.auth.admin.createUser({
              email,
              password: dummyPassword,
              email_confirm: true
            });
            if (!createError && newAuth?.user) {
              authUserId = newAuth.user.id;
            }
          }
        } catch (e) {
          console.error("Failed to list or create auth user for google express superadmin:", e);
        }

        const idToInsert = authUserId || crypto.randomUUID();

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from('profiles')
          .insert({
            id: idToInsert,
            email: email,
            role: 'admin',
            status: 'active'
          })
          .select()
          .single();
        
        if (!insertError && inserted) {
          profile = inserted;
        } else {
          profile = {
            id: idToInsert,
            email: email,
            role: 'admin',
            status: 'active'
          };
        }
      }

      userPayload = {
        id: profile.id,
        email: profile.email,
        role: profile.role || 'admin',
        platform_role: 'superadmin',
        is_platform_admin: true,
        restaurantId: profile.restaurant_id || null,
        status: 'active',
        permissions: {
          can_refund: true,
          can_edit_menu: true,
          can_cancel_order: true,
          can_view_analytics: true,
          can_manage_staff: true
        }
      };
    } else {
      console.log("Checking profiles for email:", email);
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (error) {
        console.error("Supabase profile error:", error);
        throw error;
      }

      if (profile) {
        console.log("Profile found:", profile.id);
        userPayload = {
          id: profile.id,
          email: profile.email,
          role: profile.role,
          restaurantId: profile.restaurant_id
        };
      } else {
        console.log("No profile found for email:", email);
      }
    }

    if (!userPayload) {
      console.log("Unauthorized: User not found in authorized profiles");
      return res.status(403).json({ error: "User not authorized for staff access" });
    }

    console.log("Generating JWT for user:", userPayload.id);
    const token = jwt.sign(userPayload, getJwtSecret(), { expiresIn: '7d' });
    res.json({ token, user: userPayload });
  } catch (err: any) {
    console.error("Google verify failed internally:", err);
    res.status(401).json({ error: "Google authentication failed: " + err.message });
  }
});

router.get("/me", authenticateJWT, (req, res) => {
  const user = (req as Request & { user?: any }).user;
  if (user && user.is_platform_admin !== true) {
    const settings = getStaffSettings(user.id, user.role);
    if (settings.status === 'suspended') {
      return res.status(403).json({ error: "Your staff account has been suspended by the administrator." });
    }
    return res.json({
      ...user,
      status: settings.status,
      permissions: settings.permissions
    });
  }
  res.json(user);
});

export default router;
