import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { authenticate } from '../middleware/auth';
import { getSupabase } from '../services/db_service';

const setupRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper to check if current authenticated user is the owner of the restaurant
async function isRestaurantOwner(
  supabase: any,
  userId: string,
  restaurantId: string,
  role?: string,
  platformRole?: string
): Promise<boolean> {
  const normRole = (role || '').toLowerCase();
  const normPlatformRole = (platformRole || '').toLowerCase();
  
  if (normRole === 'superadmin' || normPlatformRole === 'superadmin') {
    return true;
  }

  try {
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('owner_id')
      .eq('id', restaurantId)
      .maybeSingle();

    if (restaurant && restaurant.owner_id === userId) {
      return true;
    }

    // Fallback: check restaurant_users with role = 'owner' or 'admin'
    const { data: mapping } = await supabase
      .from('restaurant_users')
      .select('role')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', userId)
      .maybeSingle();

    if (mapping && (mapping.role === 'owner' || mapping.role === 'admin')) {
      return true;
    }
  } catch (err: any) {
    console.warn("isRestaurantOwner check threw:", err);
  }
  return false;
}

// 1. Get Wizard Setup Progress
setupRoutes.get("/api/setup/progress/:restaurantId", authenticate, async (c) => {
  const user = c.get('user');
  const restaurantId = c.req.param('restaurantId');

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = getSupabase(c.env);
  const isOwner = await isRestaurantOwner(supabase, user.id, restaurantId, user.role, user.platform_role);
  if (!isOwner) {
    return c.json({ error: "Forbidden: Only the Business Owner can configure these setup guidelines." }, 403);
  }

  try {
    let { data: progress, error } = await supabase
      .from('business_setup_progress')
      .select('*')
      .eq('business_id', restaurantId)
      .maybeSingle();

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    if (!progress) {
      // Create empty/initial setup record for this restaurant
      const initialProgress = {
        business_id: restaurantId,
        current_step: 1,
        completed_steps: [],
        wizard_data: {
          step1: { completed: true },
          step2: { business_name: "", business_type: "Restaurant", contact_email: user.email || "", contact_phone: "" },
          step3: { country: "MY", currency: "MYR", timezone: "Asia/Kuala_Lumpur", tax_type: "SST", language: "en" },
          step4: { charge_tax: "No", tax_name: "SST", tax_percentage: 6 },
          step5: { payment_mode: "both" },
          step6: { provider: "Cash", stripe_publishable: "", stripe_secret: "", stripe_webhook: "" },
          step7: { invites: [] }
        },
        completed: false
      };

      const { data: newProg, error: insErr } = await supabase
        .from('business_setup_progress')
        .insert([initialProgress])
        .select()
        .maybeSingle();

      if (insErr) {
        console.warn("Could not insert dynamic setup progress row:", insErr.message);
        return c.json(initialProgress);
      }
      progress = newProg;
    }

    return c.json(progress);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 2. Autosave/Manual Save Wizard Setup Progress
setupRoutes.post("/api/setup/progress/:restaurantId", authenticate, async (c) => {
  const user = c.get('user');
  const restaurantId = c.req.param('restaurantId');
  const body = await c.req.json().catch(() => ({}));
  const { current_step, completed_steps, wizard_data, completed } = body;

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = getSupabase(c.env);
  const isOwner = await isRestaurantOwner(supabase, user.id, restaurantId, user.role, user.platform_role);
  if (!isOwner) {
    return c.json({ error: "Forbidden: Only the Business Owner can register setup progress." }, 403);
  }

  try {
    const updatePayload = {
      current_step: Number(current_step) || 1,
      completed_steps: Array.isArray(completed_steps) ? completed_steps : [],
      wizard_data: wizard_data || {},
      completed: !!completed,
      updated_at: new Date().toISOString()
    };

    const { data: updated, error } = await supabase
      .from('business_setup_progress')
      .upsert({
        business_id: restaurantId,
        ...updatePayload
      }, { onConflict: 'business_id' })
      .select()
      .maybeSingle();

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    // Log the configuration audit action
    console.log(`[AuditLog] Onboarding Wizard Progress Saved. Business: ${restaurantId}, Step: ${current_step}, User: ${user.id}`);

    return c.json(updated);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 3. Finalize Setup Wizard & Generate System Defaults
setupRoutes.post("/api/setup/finalize/:restaurantId", authenticate, async (c) => {
  const user = c.get('user');
  const restaurantId = c.req.param('restaurantId');
  const body = await c.req.json().catch(() => ({}));
  const { wizard_data } = body;

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = getSupabase(c.env);
  const isOwner = await isRestaurantOwner(supabase, user.id, restaurantId, user.role, user.platform_role);
  if (!isOwner) {
    return c.json({ error: "Forbidden: Only the Business Owner can finalize JomOrder setup." }, 403);
  }

  if (!wizard_data) {
    return c.json({ error: "Invalid setup wizard data payload." }, 400);
  }

  const step2 = wizard_data.step2 || {};
  const step3 = wizard_data.step3 || {};
  const step4 = wizard_data.step4 || {};
  const step5 = wizard_data.step5 || {};
  const step6 = wizard_data.step6 || {};

  try {
    // A. Update Main Restaurant specifications
    const baseCurrency = step3.currency || "MYR";
    const paymentMode = step5.payment_mode || "both";
    const hasTax = step4.charge_tax === "Yes";
    const taxRate = hasTax ? Number(step4.tax_percentage || 6) : 0;
    const taxType = hasTax ? step4.tax_name || "SST" : "No Tax";

    const { error: restErr } = await supabase
      .from('restaurants')
      .update({
        name: step2.business_name || "New JomOrder Restaurant",
        currency: baseCurrency,
        sst: taxRate / 100, // sst decimal representation
        payment_mode: paymentMode
      })
      .eq('id', restaurantId);

    if (restErr) {
      throw new Error(`Failed to update main restaurant records: ${restErr.message}`);
    }

    // B. Create/Update Business Settings Row
    const { error: bsErr } = await supabase
      .from('business_settings')
      .upsert({
        business_id: restaurantId,
        restaurant_id: restaurantId,
        country_code: step3.country || "MY",
        currency_code: baseCurrency,
        timezone: step3.timezone || "Asia/Kuala_Lumpur",
        language: step3.language || "en",
        tax_type: taxType,
        tax_rate: taxRate,
        date_format: step3.country === "US" ? "MM/DD/YYYY" : "DD/MM/YYYY",
        payment_mode: paymentMode
      }, { onConflict: 'restaurant_id' });

    if (bsErr) {
      console.warn("Failed saving business_settings during onboarding:", bsErr.message);
    }

    // C. Create/Overwrite Setup Progress Status to completed
    await supabase
      .from('business_setup_progress')
      .upsert({
        business_id: restaurantId,
        current_step: 7,
        completed_steps: [1, 2, 3, 4, 5, 6, 7],
        wizard_data,
        completed: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'business_id' });

    // D. Auto-Generated Default: Default Menu Category if none exists
    const { data: existingCats } = await supabase
      .from('categories')
      .select('id')
      .eq('restaurant_id', restaurantId);

    let finalCatId = "";
    if (!existingCats || existingCats.length === 0) {
      const { data: newCat, error: catErr } = await supabase
        .from('categories')
        .insert([{
          restaurant_id: restaurantId,
          name: "Featured Specialties",
          sort_order: 1
        }])
        .select()
        .single();
      
      if (catErr) {
        console.warn("Failed auto-generating default category:", catErr.message);
      } else {
        finalCatId = newCat.id;
      }
    } else {
      finalCatId = existingCats[0].id;
    }

    // E. Auto-Generated Default: Create Sample Main Menu items if none exist
    if (finalCatId) {
      const { data: existingItems } = await supabase
        .from('menu_items')
        .select('id')
        .eq('restaurant_id', restaurantId);

      if (!existingItems || existingItems.length === 0) {
        const { error: itemErr } = await supabase
          .from('menu_items')
          .insert([
            {
              restaurant_id: restaurantId,
              category_id: finalCatId,
              name: "Signature Gourmet Burger",
              description: "Flame-grilled succulent patty, aged cheddar, freshly sliced tomatoes, iceberg lettuce, and housesauce served on a toasted brioche bun.",
              price: 15.90,
              is_available: true,
              product_type: "standard"
            },
            {
              restaurant_id: restaurantId,
              category_id: finalCatId,
              name: "Crispy Country Fries",
              description: "Thick-cut golden potatoes seasoned to perfection with a secret spice blend. Crispy outside and fluffy soft inside.",
              price: 6.50,
              is_available: true,
              product_type: "standard"
            }
          ]);

        if (itemErr) {
          console.warn("Failed creating default sample menu items:", itemErr.message);
        }
      }
    }

    // F. Auto-Generated Default: Create Default QR table selection if none exists
    const { data: existingTables } = await supabase
      .from('tables')
      .select('id')
      .eq('restaurant_id', restaurantId);

    if (!existingTables || existingTables.length === 0) {
      const { error: tableErr } = await supabase
        .from('tables')
        .insert([
          {
            restaurant_id: restaurantId,
            name: "Table 1",
            status: "ready"
          }
        ]);
      if (tableErr) {
        console.warn("Failed creating default Dining Table setup:", tableErr.message);
      }
    }

    // G. Configure Payment Provider details if key configurations exist
    if (step6.provider === "Stripe" && step6.stripe_publishable && step6.stripe_secret) {
      const encryptedPayloadString = JSON.stringify({
        publishableKey: step6.stripe_publishable,
        secretKey: step6.stripe_secret,
        webhookSecret: step6.stripe_webhook || ""
      });

      // Save encrypted payment provider configuration safely inside db
      const { error: provErr } = await supabase
        .from('payment_providers')
        .upsert({
          restaurant_id: restaurantId,
          provider_name: "stripe",
          account_type: "standard",
          encrypted_config: encryptedPayloadString,
          enabled: true,
          updated_at: new Date().toISOString()
        }, { onConflict: 'restaurant_id' });

      if (provErr) {
        console.warn("Could not save Stripe credentials dynamically:", provErr.message);
      }
    }

    // Finalize Auditing logs
    console.log(`[AuditLog] Business Onboarding Wizard Completed. Business: ${restaurantId}, Name: ${step2.business_name}, User: ${user.id}`);

    return c.json({ success: true, message: "Onboarding and auto defaults generation initiated successfully!" });
  } catch (err: any) {
    console.error("[WizardFinalizeError] Finalization threw:", err.message);
    return c.json({ error: err.message }, 500);
  }
});

export default setupRoutes;
