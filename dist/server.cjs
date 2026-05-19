var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_jsonwebtoken = __toESM(require("jsonwebtoken"), 1);
var import_cookie_parser = __toESM(require("cookie-parser"), 1);
var import_supabase_js = require("@supabase/supabase-js");
var import_google_auth_library = require("google-auth-library");
var import_dotenv = __toESM(require("dotenv"), 1);
var import_genai = require("@google/genai");
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = 3e3;
var JWT_SECRET = process.env.JWT_SECRET || "jomorder-secret-key-123";
var GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID;
var googleClient = new import_google_auth_library.OAuth2Client(GOOGLE_CLIENT_ID);
var supabaseAdmin = (0, import_supabase_js.createClient)(
  process.env.VITE_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
);
app.use(import_express.default.json());
app.use((0, import_cookie_parser.default)());
var authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }
  try {
    const decoded = import_jsonwebtoken.default.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};
app.get("/api/public/restaurants/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("restaurants").select("*, franchise_id").eq("id", req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Restaurant not found" });
  res.json(data);
});
app.get("/api/public/restaurants/:restId/categories", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("categories").select("*").eq("restaurant_id", req.params.restId).order("sort_order", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/public/restaurants/:restId/menu-items", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("menu_items").select(`
      *,
      combo_groups (*, items:combo_group_items (*, child_product:menu_items (*, combo_groups (*, items:combo_group_items (*)), modifier_groups (*, modifiers!modifiers_group_id_fkey (*))))),
      modifier_groups (*, modifiers!modifiers_group_id_fkey (*))
    `).eq("restaurant_id", req.params.restId).eq("is_active", true);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/public/tables/:tableId", async (req, res) => {
  const { restId } = req.query;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.tableId);
  let query = supabaseAdmin.from("tables").select("*");
  if (isUuid) {
    query = query.eq("id", req.params.tableId);
  } else {
    query = query.eq("restaurant_id", restId).eq("name", req.params.tableId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/public/resolve-session", async (req, res) => {
  const { restaurantId, tableId, deviceInfo, clientToken, fulfillment } = req.body;
  const { data, error } = await supabaseAdmin.rpc("resolve_dining_session_v2", {
    p_restaurant_id: restaurantId,
    p_table_id: tableId,
    p_device_info: deviceInfo,
    p_client_token: clientToken,
    p_fulfillment: fulfillment
  });
  if (error && (error.code === "PGRST202" || error.message.includes("p_fulfillment"))) {
    const retry = await supabaseAdmin.rpc("resolve_dining_session_v2", {
      p_restaurant_id: restaurantId,
      p_table_id: tableId,
      p_device_info: deviceInfo,
      p_client_token: clientToken
    });
    if (retry.error) return res.status(500).json({ error: retry.error.message });
    return res.json(retry.data);
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/public/orders/check", async (req, res) => {
  const { sessionId } = req.query;
  const { data, error, count } = await supabaseAdmin.from("orders").select("id", { count: "exact" }).eq("session_id", sessionId).order("created_at", { ascending: false }).limit(1);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ orders: data, count });
});
app.get("/api/public/baskets", async (req, res) => {
  const { sessionId } = req.query;
  const { data, error } = await supabaseAdmin.from("baskets").select("id, basket_version").eq("session_id", sessionId).eq("status", "active").maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/public/baskets/:basketId/items", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("basket_items").select("*").eq("basket_id", req.params.basketId);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/public/sync-basket-item", async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc("sync_basket_item_v2", req.body);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/public/place-order", async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc("place_order_v3", req.body);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/public/orders/:id", async (req, res) => {
  const { sessionId } = req.query;
  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("id", req.params.id).eq("session_id", sessionId).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/public/dining-sessions/:sessionId/orders", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("session_id", req.params.sessionId).neq("status", "cancelled");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/public/orders/:id/mark-paid", async (req, res) => {
  const { sessionToken } = req.body;
  const { data: session } = await supabaseAdmin.from("dining_sessions").select("id").eq("token", sessionToken).single();
  if (!session) return res.status(401).json({ error: "Invalid session token" });
  const { data, error } = await supabaseAdmin.from("orders").update({
    paid_at: (/* @__PURE__ */ new Date()).toISOString(),
    status: "confirmed",
    payment_method: "online"
  }).eq("id", req.params.id).eq("session_id", session.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/public/dining-sessions/:id/mark-paid", async (req, res) => {
  const { sessionToken } = req.body;
  const { data: session } = await supabaseAdmin.from("dining_sessions").select("id").eq("id", req.params.id).eq("token", sessionToken).single();
  if (!session) return res.status(401).json({ error: "Invalid session token" });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await supabaseAdmin.from("orders").update({
    paid_at: now,
    status: "confirmed",
    payment_method: "online"
  }).eq("session_id", session.id).is("paid_at", null).neq("status", "cancelled");
  const { data, error } = await supabaseAdmin.from("dining_sessions").update({
    status: "paid",
    closed_at: now
  }).eq("id", session.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/translate", authenticateJWT, async (req, res) => {
  const { text, targetLang, restaurantContext } = req.body;
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
  }
  try {
    const ai = new import_genai.GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } }
    });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
      You are a professional culinary translator specializing in multi-tenant restaurant systems.
      Translate the following food term or description from English to ${targetLang}.
      
      Term: "${text}"
      Restaurant Type: ${restaurantContext || "General"}
      
      Context Guidelines:
      - For Bubble Tea: Use established tea culture terms.
      - For Malaysian Restaurants: Use authentic local terms if target is Bahasa Melayu.
      - Aim for appetite appeal and accuracy.
      
      Return ONLY the translated text, no explanation or quotes.
      `
    });
    const translatedText = response.text.trim();
    res.json({ translatedText });
  } catch (error) {
    console.error("AI Translation failed:", error);
    res.status(500).json({ error: "Translation failed" });
  }
});
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const envAdminEmail = process.env.ADMIN_USER_EMAIL;
  const envAdminPass = process.env.ADMIN_USER_PASSWORD;
  if (envAdminEmail && email === envAdminEmail && password === envAdminPass) {
    const token = import_jsonwebtoken.default.sign({ id: "admin", email, role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token, user: { id: "admin", email, role: "admin" } });
  }
  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });
    if (authData && authData.user) {
      const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("*").eq("id", authData.user.id).maybeSingle();
      if (profile) {
        const token = import_jsonwebtoken.default.sign({
          id: profile.id,
          email: profile.email,
          role: profile.role,
          restaurantId: profile.restaurant_id
        }, JWT_SECRET, { expiresIn: "7d" });
        return res.json({ token, user: profile });
      }
    }
    const { data: legacyProfile, error: legacyError } = await supabaseAdmin.from("profiles").select("*").eq("email", email).maybeSingle();
    if (legacyProfile && (password === "staff123" || envAdminPass && password === envAdminPass)) {
      const token = import_jsonwebtoken.default.sign({
        id: legacyProfile.id,
        email: legacyProfile.email,
        role: legacyProfile.role,
        restaurantId: legacyProfile.restaurant_id
      }, JWT_SECRET, { expiresIn: "7d" });
      return res.json({ token, user: legacyProfile });
    }
    res.status(401).json({ error: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  try {
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
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").insert({
      id: authUser.user.id,
      email,
      role: "staff"
      // Default role for new registrations
    }).select().single();
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      throw profileError;
    }
    const token = import_jsonwebtoken.default.sign({
      id: profile.id,
      email: profile.email,
      role: profile.role,
      restaurantId: profile.restaurant_id
    }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: profile });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/google-login", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: "Missing token" });
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error("Invalid Google payload");
    const email = payload.email;
    let userPayload = null;
    if (process.env.ADMIN_USER_EMAIL && email === process.env.ADMIN_USER_EMAIL) {
      userPayload = { id: "admin", email, role: "admin" };
    } else {
      const { data: profile, error } = await supabaseAdmin.from("profiles").select("*").eq("email", email).maybeSingle();
      if (error) throw error;
      if (profile) {
        userPayload = {
          id: profile.id,
          email: profile.email,
          role: profile.role,
          restaurantId: profile.restaurant_id
        };
      }
    }
    if (!userPayload) {
      return res.status(403).json({ error: "User not authorized for staff access" });
    }
    const token = import_jsonwebtoken.default.sign(userPayload, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: userPayload });
  } catch (err) {
    console.error("Google verify failed:", err);
    res.status(401).json({ error: "Google authentication failed" });
  }
});
app.get("/api/me", authenticateJWT, (req, res) => {
  res.json(req.user);
});
app.get("/api/translation-jobs", authenticateJWT, async (req, res) => {
  const { filter } = req.query;
  let query = supabaseAdmin.from("translation_jobs").select("*").order("created_at", { ascending: false });
  if (filter && filter !== "all") {
    query = query.eq("review_status", filter);
  } else {
    query = query.neq("review_status", "approved");
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch("/api/translation-jobs/:id", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("translation_jobs").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch("/api/tenant-translations", authenticateJWT, async (req, res) => {
  const { restaurantId, entityId, fieldName, languageCode, translatedText } = req.body;
  const { data, error } = await supabaseAdmin.from("tenant_translations").update({ translated_text: translatedText }).eq("restaurant_id", restaurantId).eq("entity_id", entityId).eq("field_name", fieldName).eq("language_code", languageCode).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/restaurants/:id", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("restaurants").select("*").eq("id", req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch("/api/restaurants/:id", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("restaurants").update(req.body).eq("id", req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/restaurants/:restId/categories", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("categories").select("*").eq("restaurant_id", req.params.restId).order("sort_order", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/categories", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("categories").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete("/api/categories/:id", authenticateJWT, async (req, res) => {
  const { error } = await supabaseAdmin.from("categories").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});
app.get("/api/restaurants/:restId/menu-items", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("menu_items").select(`
      *,
      display_behavior,
      combo_groups (
        *,
        combo_group_items (
          *,
          child_product:menu_items (
            id,
            name,
            base_price,
            product_type
          )
        )
      ),
      modifier_groups (
        *,
        modifiers!modifiers_group_id_fkey (*)
      )
    `).eq("restaurant_id", req.params.restId);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/menu-items", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("menu_items").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch("/api/menu-items/:id", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("menu_items").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete("/api/menu-items/:id", authenticateJWT, async (req, res) => {
  const { error } = await supabaseAdmin.from("menu_items").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});
app.get("/api/restaurants/:restId/tables", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("tables").select("*, current_session:dining_sessions!tables_current_session_id_fkey(*)").eq("restaurant_id", req.params.restId).order("name", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/tables", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("tables").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch("/api/tables/:id", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("tables").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete("/api/tables/:id", authenticateJWT, async (req, res) => {
  const { error } = await supabaseAdmin.from("tables").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});
app.get("/api/restaurants/:restId/orders", authenticateJWT, async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const { data, error } = await supabaseAdmin.from("orders").select("*, tables(name), payments(amount)").eq("restaurant_id", req.params.restId).order("created_at", { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch("/api/orders/:id", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("orders").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/restaurants/:restId/dining-sessions", authenticateJWT, async (req, res) => {
  const status = req.query.status;
  let query = supabaseAdmin.from("dining_sessions").select("*, orders(id, total_price, status, paid_at, items, session_id)").eq("restaurant_id", req.params.restId);
  if (status === "active") {
    query = query.neq("status", "paid").neq("status", "expired");
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/dining-sessions/:id/orders", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("orders").select("*, payments(amount)").eq("session_id", req.params.id).neq("status", "cancelled");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/dining-sessions/:id/settle", authenticateJWT, async (req, res) => {
  const { orderIds, paidAmount } = req.body;
  try {
    const { error: orderError } = await supabaseAdmin.from("orders").update({
      paid_at: (/* @__PURE__ */ new Date()).toISOString(),
      payment_method: "counter"
    }).in("id", orderIds);
    if (orderError) throw orderError;
    const { error: sessionError } = await supabaseAdmin.from("dining_sessions").update({
      status: "paid",
      paid_amount: paidAmount
    }).eq("id", req.params.id);
    if (sessionError) throw sessionError;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.patch("/api/dining-sessions/:id", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("dining_sessions").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/api/orders/:orderId/payments", authenticateJWT, async (req, res) => {
  const { sessionId } = req.query;
  let query;
  if (sessionId) {
    const { data: orders } = await supabaseAdmin.from("orders").select("id").eq("session_id", sessionId);
    const orderIds = (orders || []).map((o) => o.id);
    if (orderIds.length === 0) return res.json([]);
    query = supabaseAdmin.from("payments").select("*").in("order_id", orderIds);
  } else {
    query = supabaseAdmin.from("payments").select("*").eq("order_id", req.params.orderId);
  }
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/orders/:orderId/payments", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("payments").insert({
    ...req.body,
    order_id: req.params.orderId
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/cash-transactions", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("cash_transactions").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/batch-sync", authenticateJWT, async (req, res) => {
  const { entity, productId, data } = req.body;
  try {
    if (entity === "combo_groups") {
      await supabaseAdmin.from("combo_groups").delete().eq("combo_product_id", productId);
      if (data && data.length > 0) {
        for (const group of data) {
          const { data: newGroup, error: groupError } = await supabaseAdmin.from("combo_groups").insert({
            combo_product_id: productId,
            name: group.name,
            description: group.description,
            required: group.required,
            min_select: group.min_select,
            max_select: group.max_select,
            display_behavior: group.display_behavior,
            importance: group.importance,
            sort_order: group.sort_order
          }).select().single();
          if (groupError) throw groupError;
          if (group.items && group.items.length > 0) {
            const items = group.items.map((i) => ({ ...i, group_id: newGroup.id }));
            await supabaseAdmin.from("combo_group_items").insert(items);
          }
        }
      }
    } else if (entity === "modifier_groups") {
      await supabaseAdmin.from("modifier_groups").delete().eq("product_id", productId);
      if (data && data.length > 0) {
        for (const group of data) {
          const { data: newGroup, error: groupError } = await supabaseAdmin.from("modifier_groups").insert({
            product_id: productId,
            parent_modifier_id: group.parent_modifier_id,
            name: group.name,
            required: group.required,
            min_select: group.min_select,
            max_select: group.max_select,
            display_behavior: group.display_behavior,
            sort_order: group.sort_order
          }).select().single();
          if (groupError) throw groupError;
          if (group.modifiers && group.modifiers.length > 0) {
            const modifiers = group.modifiers.map((m) => ({ ...m, group_id: newGroup.id }));
            await supabaseAdmin.from("modifiers").insert(modifiers);
          }
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/public/payments", async (req, res) => {
  const { restaurantId, orderId, amount, method, provider } = req.body;
  const { data, error } = await supabaseAdmin.from("payments").insert({
    restaurant_id: restaurantId,
    order_id: orderId,
    amount,
    payment_method: method,
    provider,
    status: "pending"
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/public/payments/:id/initialize", async (req, res) => {
  const { id } = req.params;
  const { data: payment, error: pError } = await supabaseAdmin.from("payments").select("*").eq("id", id).single();
  if (pError) return res.status(500).json({ error: pError.message });
  await supabaseAdmin.from("payment_attempts").insert({
    payment_id: id,
    status: "initiated"
  });
  switch (payment.payment_method) {
    case "duitnow":
    case "tng":
      return res.json({
        paymentId: payment.id,
        provider: payment.provider,
        paymentMethod: payment.payment_method,
        qrData: `00020101021126600010com.paynet.qr0111MY123456780211MY123456780303001520400005303458540${payment.amount.toFixed(2)}5802MY5907POS_SAAS6008Lumpur6105500006304`
      });
    case "fpx":
    case "card":
      return res.json({
        paymentId: payment.id,
        provider: payment.provider,
        paymentMethod: payment.payment_method,
        redirectUrl: "/simulated-gateway"
      });
    default:
      res.status(400).json({ error: "Unsupported method" });
  }
});
app.get("/api/public/payments/:id/status", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("payments").select("status").eq("id", req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/api/public/payments/:id/simulate-success", async (req, res) => {
  const { id } = req.params;
  const { data: payment, error: fetchError } = await supabaseAdmin.from("payments").select("order_id").eq("id", id).single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  const paidAt = (/* @__PURE__ */ new Date()).toISOString();
  await supabaseAdmin.from("payments").update({
    status: "paid",
    paid_at: paidAt,
    external_id: `SIM_${Math.random().toString(36).substring(7).toUpperCase()}`
  }).eq("id", id);
  await supabaseAdmin.from("orders").update({
    paid_at: paidAt,
    status: "confirmed"
  }).eq("id", payment.order_id);
  await supabaseAdmin.from("payment_attempts").insert({
    payment_id: id,
    status: "success",
    provider_response: { mode: "simulation", timestamp: paidAt }
  });
  res.json({ success: true });
});
app.post("/api/public/batch-translate", async (req, res) => {
  const { items, categories, context } = req.body;
  const { restaurantId, franchiseId, targetLanguage } = context;
  if (targetLanguage === "en") {
    return res.json({ items, categories });
  }
  try {
    const resolveSingle = async (entityId, entityType, fieldName, defaultText) => {
      const { data: branchData } = await supabaseAdmin.from("branch_translations").select("translated_text").eq("restaurant_id", restaurantId).eq("entity_id", entityId).eq("language_code", targetLanguage).maybeSingle();
      if (branchData?.translated_text) return branchData.translated_text;
      if (franchiseId) {
        const { data: franchiseData } = await supabaseAdmin.from("franchise_translations").select("translated_text").eq("franchise_id", franchiseId).eq("entity_id", entityId).eq("language_code", targetLanguage).maybeSingle();
        if (franchiseData?.translated_text) return franchiseData.translated_text;
      }
      const { data: tenantData } = await supabaseAdmin.from("tenant_translations").select("translated_text").eq("restaurant_id", restaurantId).eq("entity_id", entityId).eq("entity_type", entityType).eq("field_name", fieldName).eq("language_code", targetLanguage).maybeSingle();
      if (tenantData?.translated_text) return tenantData.translated_text;
      const { data: globalData } = await supabaseAdmin.from("global_translations").select("translated_text").eq("term_key", fieldName === "name" ? defaultText : `${entityType}_${fieldName}`).eq("language_code", targetLanguage).maybeSingle();
      if (globalData?.translated_text) return globalData.translated_text;
      return defaultText;
    };
    const translatedItems = items ? await Promise.all(items.map(async (item) => {
      const name = await resolveSingle(item.id, "menu_item", "name", item.name);
      const description = item.description ? await resolveSingle(item.id, "menu_item", "description", item.description) : item.description;
      return { ...item, name, description };
    })) : null;
    const translatedCats = categories ? await Promise.all(categories.map(async (cat) => {
      const name = await resolveSingle(cat.id, "category", "name", cat.name);
      return { ...cat, name };
    })) : null;
    res.json({ items: translatedItems, categories: translatedCats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/public/kitchen-canonical/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("kitchen_canonical_names").select("canonical_name").eq("menu_item_id", req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}
start();
//# sourceMappingURL=server.cjs.map
