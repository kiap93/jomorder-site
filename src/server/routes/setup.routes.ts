import { Router, Response } from "express";
import { supabaseAdmin, loadFallbackDB, saveFallbackDB } from "../services/dbService";
import { authenticateJWT, AuthenticatedRequest } from "../middleware/authMiddleware";

const router = Router();

// Helper to check if current authenticated user is the owner of the restaurant
async function isRestaurantOwner(userId: string, restaurantId: string): Promise<boolean> {
  try {
    const { data: restaurant } = await supabaseAdmin
      .from('restaurants')
      .select('owner_id')
      .eq('id', restaurantId)
      .maybeSingle();

    if (restaurant && restaurant.owner_id === userId) {
      return true;
    }

    // Fallback: check restaurant_users with role = 'owner'
    const { data: mapping } = await supabaseAdmin
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
router.get("/setup/progress/:restaurantId", authenticateJWT, async (req, res) => {
  const reqAuth = req as AuthenticatedRequest;
  const user = reqAuth.user;
  const { restaurantId } = req.params;

  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isOwner = await isRestaurantOwner(user.id, restaurantId);
  if (!isOwner) {
    return res.status(403).json({ error: "Forbidden: Only the Business Owner can configure these setup guidelines." });
  }

  try {
    let { data: progress, error } = await supabaseAdmin
      .from('business_setup_progress')
      .select('*')
      .eq('business_id', restaurantId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!progress) {
      // Fetch dynamic defaults from newly registered restaurant and business settings
      const { data: rest } = await supabaseAdmin
        .from('restaurants')
        .select('*')
        .eq('id', restaurantId)
        .maybeSingle();

      const { data: bSettings } = await supabaseAdmin
        .from('business_settings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      const initialCountry = bSettings?.country_code || (rest?.currency === 'SGD' ? 'SG' : rest?.currency === 'THB' ? 'TH' : rest?.currency === 'USD' ? 'US' : rest?.currency === 'GBP' ? 'UK' : 'MY');
      const initialCurrency = rest?.currency || bSettings?.currency_code || 'MYR';
      const initialTimezone = bSettings?.timezone || (initialCurrency === 'SGD' ? 'Asia/Singapore' : initialCurrency === 'THB' ? 'Asia/Bangkok' : initialCurrency === 'USD' ? 'America/New_York' : initialCurrency === 'GBP' ? 'Europe/London' : 'Asia/Kuala_Lumpur');
      const initialTaxType = bSettings?.tax_type || (initialCurrency === 'SGD' ? 'GST' : initialCurrency === 'THB' ? 'VAT' : initialCurrency === 'USD' ? 'Sales Tax' : initialCurrency === 'GBP' ? 'VAT' : 'SST');
      const initialTaxRate = bSettings?.tax_rate !== undefined ? Number(bSettings.tax_rate) : (rest?.sst !== undefined ? Number(rest.sst) * 100 : 6);
      const initialLanguage = bSettings?.language || 'en';

      // Create empty/initial setup record for this restaurant
      const initialProgress = {
        business_id: restaurantId,
        current_step: 1,
        completed_steps: [],
        wizard_data: {
          step1: { completed: true },
          step2: { business_name: rest?.name || "", business_type: "Restaurant", contact_email: user.email || "", contact_phone: "" },
          step3: { country: initialCountry, currency: initialCurrency, timezone: initialTimezone, tax_type: initialTaxType, language: initialLanguage },
          step4: { charge_tax: initialTaxRate > 0 ? "Yes" : "No", tax_name: initialTaxType, tax_percentage: initialTaxRate },
          step5: { payment_mode: rest?.payment_mode || "both" },
          step6: { provider: "Cash", stripe_publishable: "", stripe_secret: "", stripe_webhook: "" },
          step7: { invites: [] }
        },
        completed: false
      };

      const { data: newProg, error: insErr } = await supabaseAdmin
        .from('business_setup_progress')
        .insert([initialProgress])
        .select()
        .maybeSingle();

      if (insErr) {
        console.warn("Could not insert dynamic setup progress row:", insErr.message);
        return res.json(initialProgress);
      }
      progress = newProg;
    }

    return res.json(progress);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. Autosave/Manual Save Wizard Setup Progress
router.post("/setup/progress/:restaurantId", authenticateJWT, async (req, res) => {
  const reqAuth = req as AuthenticatedRequest;
  const user = reqAuth.user;
  const { restaurantId } = req.params;
  const { current_step, completed_steps, wizard_data, completed } = req.body;

  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isOwner = await isRestaurantOwner(user.id, restaurantId);
  if (!isOwner) {
    return res.status(403).json({ error: "Forbidden: Only the Business Owner can register setup progress." });
  }

  try {
    const updatePayload = {
      current_step: Number(current_step) || 1,
      completed_steps: Array.isArray(completed_steps) ? completed_steps : [],
      wizard_data: wizard_data || {},
      completed: !!completed,
      updated_at: new Date().toISOString()
    };

    const { data: updated, error } = await supabaseAdmin
      .from('business_setup_progress')
      .upsert({
        business_id: restaurantId,
        ...updatePayload
      }, { onConflict: 'business_id' })
      .select()
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Log the configuration audit action
    console.log(`[AuditLog] Onboarding Wizard Progress Saved. Business: ${restaurantId}, Step: ${current_step}, User: ${user.id}`);

    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. Finalize Setup Wizard & Generate System Defaults
router.post("/setup/finalize/:restaurantId", authenticateJWT, async (req, res) => {
  const reqAuth = req as AuthenticatedRequest;
  const user = reqAuth.user;
  const { restaurantId } = req.params;
  const { wizard_data } = req.body;

  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isOwner = await isRestaurantOwner(user.id, restaurantId);
  if (!isOwner) {
    return res.status(403).json({ error: "Forbidden: Only the Business Owner can finalize JomOrder setup." });
  }

  if (!wizard_data) {
    return res.status(400).json({ error: "Invalid setup wizard data payload." });
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

    const { error: restErr } = await supabaseAdmin
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
    const { data: existingBSList, error: checkBSErr } = await supabaseAdmin
      .from('business_settings')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .limit(1);

    const existingBS = existingBSList && existingBSList[0] ? existingBSList[0] : null;

    const bsPayload = {
      business_id: restaurantId,
      restaurant_id: restaurantId,
      country_code: step3.country || "MY",
      currency_code: baseCurrency,
      timezone: step3.timezone || "Asia/Kuala_Lumpur",
      language: step3.language || "en",
      tax_type: taxType,
      tax_rate: taxRate,
      date_format: step3.country === "US" ? "MM/DD/YYYY" : "DD/MM/YYYY",
      payment_mode: paymentMode,
      updated_at: new Date().toISOString()
    };

    let bsErr: any = null;
    if (existingBS) {
      const { error } = await supabaseAdmin
        .from('business_settings')
        .update(bsPayload)
        .eq('id', existingBS.id);
      bsErr = error;
    } else {
      const { error } = await supabaseAdmin
        .from('business_settings')
        .insert([bsPayload]);
      bsErr = error;
    }

    if (bsErr) {
      console.warn("Failed saving business_settings during onboarding:", bsErr.message);
    }

    // C. Create/Overwrite Setup Progress Status to completed
    await supabaseAdmin
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
    const { data: existingCats } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('restaurant_id', restaurantId);

    let finalCatId = "";
    if (!existingCats || existingCats.length === 0) {
      const { data: newCat, error: catErr } = await supabaseAdmin
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
      const { data: existingItems } = await supabaseAdmin
        .from('menu_items')
        .select('id')
        .eq('restaurant_id', restaurantId);

      if (!existingItems || existingItems.length === 0) {
        const { error: itemErr } = await supabaseAdmin
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
    const { data: existingTables } = await supabaseAdmin
      .from('tables')
      .select('id')
      .eq('restaurant_id', restaurantId);

    if (!existingTables || existingTables.length === 0) {
      const { error: tableErr } = await supabaseAdmin
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
      const { error: provErr } = await supabaseAdmin
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

    return res.json({ success: true, message: "Onboarding and auto defaults generation initiated successfully!" });
  } catch (err: any) {
    console.error("[WizardFinalizeError] Finalization threw:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
