import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { authenticate } from '../middleware/auth';
import { 
  createImportJob, 
  getImportJob, 
  getAllImportJobs,
  parseMenuZip, 
  validateImportData, 
  executeTransactionalImport,
  generateCSV
} from '../../src/server/services/menuImportService';
import { getSupabase } from '../services/db_service';
import JSZip from 'jszip';

const menuImportRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 1. GET /api/menu-import/templates -> Download sample zip
menuImportRoutes.get("/api/menu-import/templates", async (c) => {
  try {
    const zip = new JSZip();

    const itemsCsv = generateCSV(
      ["item_code", "name", "category_name", "price", "base_price", "description", "is_active", "product_type", "image_url"],
      [
        {
          item_code: "ITM-001",
          name: "Nasi Lemak Ayam",
          category_name: "Main Course",
          price: "12.90",
          base_price: "12.90",
          description: "Traditional Malay fragrant rice with crispy fried chicken",
          is_active: "true",
          product_type: "configurable",
          image_url: "https://example.com/nasilemak.jpg"
        },
        {
          item_code: "ITM-002",
          name: "Teh Tarik",
          category_name: "Beverage",
          price: "3.50",
          base_price: "3.50",
          description: "Local pulled frothy milk tea",
          is_active: "true",
          product_type: "single",
          image_url: "https://example.com/tehtarik.jpg"
        },
        {
          item_code: "ITM-003",
          name: "Signature Combo",
          category_name: "Main Course",
          price: "15.90",
          base_price: "15.90",
          description: "Nasi Lemak Ayam paired with cold Teh Tarik",
          is_active: "true",
          product_type: "combo",
          image_url: ""
        },
        {
          item_code: "ITM-004",
          name: "Ice Cream Scoop",
          category_name: "Dessert",
          price: "4.50",
          base_price: "4.50",
          description: "Vanilla ice cream",
          is_active: "true",
          product_type: "single",
          image_url: ""
        }
      ]
    );

    const configGroupsCsv = generateCSV(
      ["group_code", "name", "required", "min_select", "max_select", "sort_order"],
      [
        {
          group_code: "GRP-ICE-ST",
          name: "Ice Preference",
          required: "false",
          min_select: "0",
          max_select: "1",
          sort_order: "1"
        }
      ]
    );

    const configOptionsCsv = generateCSV(
      ["option_code", "group_code", "name", "price_delta", "is_default", "sort_order"],
      [
        {
          option_code: "OPT-ICE-N",
          group_code: "GRP-ICE-ST",
          name: "No Ice",
          price_delta: "0.00",
          is_default: "false",
          sort_order: "1"
        },
        {
          option_code: "OPT-ICE-L",
          group_code: "GRP-ICE-ST",
          name: "Less Ice",
          price_delta: "0.00",
          is_default: "true",
          sort_order: "2"
        }
      ]
    );

    const itemConfigMappingCsv = generateCSV(
      ["item_code", "group_code"],
      [
        { item_code: "ITM-002", group_code: "GRP-ICE-ST" }
      ]
    );

    const comboItemsCsv = generateCSV(
      ["combo_product_code", "group_code"],
      [
        { combo_product_code: "ITM-003", group_code: "CMB-GRP-FOD" },
        { combo_product_code: "ITM-003", group_code: "CMB-GRP-DRK" }
      ]
    );

    const comboChoiceGroupsCsv = generateCSV(
      ["group_code", "combo_product_code", "name", "description", "required", "min_select", "max_select", "sort_order"],
      [
        {
          group_code: "CMB-GRP-FOD",
          combo_product_code: "ITM-003",
          name: "Select Main Dish",
          description: "Choose your main morning meal",
          required: "true",
          min_select: "1",
          max_select: "1",
          sort_order: "1"
        },
        {
          group_code: "CMB-GRP-DRK",
          combo_product_code: "ITM-003",
          name: "Select Beverage",
          description: "Choose your iced drink option",
          required: "true",
          min_select: "1",
          max_select: "1",
          sort_order: "2"
        }
      ]
    );

    const comboChoiceOptionsCsv = generateCSV(
      ["option_code", "group_code", "child_item_code", "custom_name", "price_delta", "default_selected", "sort_order"],
      [
        {
          option_code: "CMB-OPT-NL",
          group_code: "CMB-GRP-FOD",
          child_item_code: "ITM-001",
          custom_name: "Hot Nasi Lemak Original",
          price_delta: "0.00",
          default_selected: "true",
          sort_order: "1"
        },
        {
          option_code: "CMB-OPT-TT",
          group_code: "CMB-GRP-DRK",
          child_item_code: "ITM-002",
          custom_name: "Pulled Teh Tarik (Teh C)",
          price_delta: "0.00",
          default_selected: "true",
          sort_order: "1"
        },
        {
          option_code: "CMB-OPT-IC",
          group_code: "CMB-GRP-DRK",
          child_item_code: "ITM-004",
          custom_name: "Scoop of Premium Vanilla Ice Cream",
          price_delta: "1.50",
          default_selected: "false",
          sort_order: "2"
        }
      ]
    );

    zip.file("items.csv", itemsCsv);
    zip.file("config-groups.csv", configGroupsCsv);
    zip.file("config-options.csv", configOptionsCsv);
    zip.file("item-config-mapping.csv", itemConfigMappingCsv);
    zip.file("combo-items.csv", comboItemsCsv);
    zip.file("combo-choice-groups.csv", comboChoiceGroupsCsv);
    zip.file("combo-choice-options.csv", comboChoiceOptionsCsv);

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    
    // Set headers manually in Hono response
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", "attachment; filename=jomorder_menu_template.zip");
    return c.body(buffer);
  } catch (err: any) {
    return c.json({ error: "Could not assemble templates: " + err.message }, 500);
  }
});

// 2. POST /api/menu-import/upload -> Parse and Validate zip upload
menuImportRoutes.post("/api/menu-import/upload", authenticate, async (c) => {
  const caller = c.get('user');
  if (!caller) return c.json({ error: "Missing credential session" }, 401);

  const { zipBase64 } = await c.req.json();
  if (!zipBase64) {
    return c.json({ error: "Missing uploaded zipBase64 data in payload" }, 400);
  }

  const supabase = getSupabase(c.env);
  const job = await createImportJob(supabase, caller.restaurantId);
  job.status = 'validating';
  job.message = 'Decompressing ZIP files and parsing CSVs...';

  try {
    const buffer = Buffer.from(zipBase64, 'base64');
    const parsed = await parseMenuZip(buffer);
    job.parsedData = parsed;

    // Load existing items of this restaurant to run comparisons for previewing
    const { data: existingItems, error: itemsErr } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', caller.restaurantId);

    if (itemsErr) throw itemsErr;

    const validation = validateImportData(parsed, existingItems || []);
    
    job.status = 'validation_complete';
    job.progress = 100;
    job.message = validation.errors.length > 0 
      ? `Validation failed with ${validation.errors.length} fatal errors.`
      : `Ready for import. Found ${validation.preview.newRecords.length} new records and ${validation.preview.updatedRecords.length} updates.`;
    
    job.preview = validation.preview;

    return c.json({
      jobId: job.id,
      status: job.status,
      message: job.message,
      preview: validation.preview,
      errors: validation.errors,
      warnings: validation.warnings
    });
  } catch (err: any) {
    job.status = 'failed';
    job.message = "Failed to parse ZIP structure: " + err.message;
    return c.json({
      error: job.message,
      jobId: job.id
    }, 400);
  }
});

// 3. POST /api/menu-import/jobs/:jobId/confirm -> Trigger Background Job Transactionally
menuImportRoutes.post("/api/menu-import/jobs/:jobId/confirm", authenticate, async (c) => {
  const caller = c.get('user');
  if (!caller) return c.json({ error: "Unauthorized access" }, 401);

  const jobId = c.req.param('jobId');
  const supabase = getSupabase(c.env);
  const job = await getImportJob(supabase, jobId);

  if (!job) {
    return c.json({ error: "Import job context not found." }, 404);
  }

  if (job.status !== 'validation_complete') {
    return c.json({ error: "Job must be validated successfully before execution confirmation." }, 400);
  }

  if (job.preview?.errors && job.preview.errors.length > 0) {
    return c.json({ error: "Cannot commit an import with unresolved fatal validation diagnostics." }, 400);
  }

  // Trigger background runner
  if (c.executionCtx) {
    c.executionCtx.waitUntil(executeTransactionalImport(supabase, jobId));
  } else {
    // Local / development synchronous fallback
    Promise.resolve().then(async () => {
      try {
        await executeTransactionalImport(supabase, jobId);
      } catch (err) {
        console.error("[BG job error]", err);
      }
    });
  }

  return c.json({
    jobId: job.id,
    status: 'queued',
    message: 'Import committed successfully. Background runner engaged.'
  });
});

// 4. GET /api/menu-import/jobs/:jobId/status -> Live Query Progress
menuImportRoutes.get("/api/menu-import/jobs/:jobId/status", authenticate, async (c) => {
  const jobId = c.req.param('jobId');
  const supabase = getSupabase(c.env);
  const job = await getImportJob(supabase, jobId);
  if (!job) {
    return c.json({ error: "Job context has expired or search query is invalid." }, 404);
  }
  return c.json(job);
});

// 5. GET /api/menu-import/history -> Fetch History Report Lists
menuImportRoutes.get("/api/menu-import/history", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  return c.json(await getAllImportJobs(supabase));
});

// 6. GET /api/menu-import/export -> Fetch and Compile perfect Export ZIP
menuImportRoutes.get("/api/menu-import/export", authenticate, async (c) => {
  const caller = c.get('user');
  if (!caller) return c.json({ error: "Credential verification failed" }, 401);

  const restId = caller.restaurantId;
  const supabase = getSupabase(c.env);

  try {
    // 1. Categories
    const { data: cats } = await supabase.from('categories').select('*').eq('restaurant_id', restId);
    const categoryMap = new Map<string, string>();
    cats?.forEach(c => categoryMap.set(c.id, c.name));

    // 2. Menu Items
    const { data: items } = await supabase.from('menu_items').select('*').eq('restaurant_id', restId);
    
    // Index item codes
    const itemCodeMap = new Map<string, string>(); // uuid -> code
    const itemsRows = (items || []).map((item) => {
      const code = item.options?.item_code || `ITM-${item.id.slice(0, 8).toUpperCase()}`;
      itemCodeMap.set(item.id, code);

      return {
        item_code: code,
        name: item.name,
        category_name: categoryMap.get(item.category_id || "") || "",
        price: item.price || item.base_price || "0.00",
        base_price: item.base_price || item.price || "0.00",
        description: item.description || "",
        is_active: String(item.is_active),
        product_type: item.product_type || "single",
        image_url: item.image_url || ""
      };
    });

    // 3. Modifier Groups
    const itemIds = (items || []).map(i => i.id);
    let modGroups: any[] = [];
    let modifiers: any[] = [];
    if (itemIds.length > 0) {
      const { data: mG } = await supabase.from('modifier_groups').select('*').in('product_id', itemIds);
      modGroups = mG || [];
      if (modGroups.length > 0) {
        const mgIds = modGroups.map(g => g.id);
        const { data: mod } = await supabase.from('modifiers').select('*').in('group_id', mgIds);
        modifiers = mod || [];
      }
    }

    const groupCodeMap = new Map<string, string>(); // groupUuid -> group_code
    const configGroupsRows = modGroups.map((g) => {
      const code = g.display_behavior?.group_code || `GRP-MOD-${g.id.slice(0, 8).toUpperCase()}`;
      groupCodeMap.set(g.id, code);

      return {
        group_code: code,
        name: g.name,
        required: String(g.required),
        min_select: String(g.min_select || "0"),
        max_select: String(g.max_select || "1"),
        sort_order: String(g.sort_order || "0")
      };
    });

    const configOptionsRows = modifiers.map(m => {
      const code = m.display_behavior?.option_code || `OPT-${m.id.slice(0, 8).toUpperCase()}`;
      const parentGCode = groupCodeMap.get(m.group_id) || "UNKNOWN";
      return {
        option_code: code,
        group_code: parentGCode,
        name: m.name,
        price_delta: m.price_delta || "0.00",
        is_default: String(m.is_default),
        sort_order: String(m.sort_order || "0")
      };
    });

    const itemConfigMappingRows: any[] = [];
    modGroups.forEach(g => {
      const parentItemCode = itemCodeMap.get(g.product_id);
      const groupCode = groupCodeMap.get(g.id);
      if (parentItemCode && groupCode) {
        itemConfigMappingRows.push({
          item_code: parentItemCode,
          group_code: groupCode
        });
      }
    });

    // 4. Combo Groups and Items
    let comboGroups: any[] = [];
    let comboGroupItems: any[] = [];
    if (itemIds.length > 0) {
      const { data: cG } = await supabase.from('combo_groups').select('*').in('combo_product_id', itemIds);
      comboGroups = cG || [];
      if (comboGroups.length > 0) {
        const cgIds = comboGroups.map(g => g.id);
        const { data: cI } = await supabase.from('combo_group_items').select('*').in('group_id', cgIds);
        comboGroupItems = cI || [];
      }
    }

    const comboGroupCodeMap = new Map<string, string>(); // groupUuid -> group_code
    const comboChoiceGroupsRows = comboGroups.map(cg => {
      const code = cg.display_behavior?.group_code || `GRP-CMB-${cg.id.slice(0, 8).toUpperCase()}`;
      comboGroupCodeMap.set(cg.id, code);

      return {
        group_code: code,
        combo_product_code: itemCodeMap.get(cg.combo_product_id) || "UNKNOWN",
        name: cg.name,
        description: cg.description || "",
        required: String(cg.required),
        min_select: String(cg.min_select || "0"),
        max_select: String(cg.max_select || "1"),
        sort_order: String(cg.sort_order || "0")
      };
    });

    const comboItemsRows: any[] = [];
    comboGroups.forEach(cg => {
      const mainCode = itemCodeMap.get(cg.combo_product_id);
      const groupCode = comboGroupCodeMap.get(cg.id);
      if (mainCode && groupCode) {
        comboItemsRows.push({
          combo_product_code: mainCode,
          group_code: groupCode
        });
      }
    });

    const comboChoiceOptionsRows = comboGroupItems.map(ci => {
      const mainCode = comboGroupCodeMap.get(ci.group_id) || "UNKNOWN";
      return {
        option_code: ci.display_behavior?.option_code || `COPT-${ci.id.slice(0, 8).toUpperCase()}`,
        group_code: mainCode,
        child_item_code: itemCodeMap.get(ci.child_product_id) || "UNKNOWN",
        custom_name: ci.custom_name || "",
        price_delta: ci.price_delta || "0.00",
        default_selected: String(ci.default_selected),
        sort_order: String(ci.sort_order || "0")
      };
    });

    // 5. ZIP assemble
    const zip = new JSZip();
    zip.file("items.csv", generateCSV(["item_code", "name", "category_name", "price", "base_price", "description", "is_active", "product_type", "image_url"], itemsRows));
    zip.file("config-groups.csv", generateCSV(["group_code", "name", "required", "min_select", "max_select", "sort_order"], configGroupsRows));
    zip.file("config-options.csv", generateCSV(["option_code", "group_code", "name", "price_delta", "is_default", "sort_order"], configOptionsRows));
    zip.file("item-config-mapping.csv", generateCSV(["item_code", "group_code"], itemConfigMappingRows));
    zip.file("combo-items.csv", generateCSV(["combo_product_code", "group_code"], comboItemsRows));
    zip.file("combo-choice-groups.csv", generateCSV(["group_code", "combo_product_code", "name", "description", "required", "min_select", "max_select", "sort_order"], comboChoiceGroupsRows));
    zip.file("combo-choice-options.csv", generateCSV(["option_code", "group_code", "child_item_code", "custom_name", "price_delta", "default_selected", "sort_order"], comboChoiceOptionsRows));

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", "attachment; filename=jomorder_exported_menu.zip");
    return c.body(zipBuffer);
  } catch (err: any) {
    return c.json({ error: "Could not export menu database files: " + err.message }, 500);
  }
});

export default menuImportRoutes;
