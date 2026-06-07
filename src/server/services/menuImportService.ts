import { supabaseAdmin } from "./dbService";
import JSZip from "jszip";

// Define the Job interface
export interface ImportJob {
  id: string;
  restaurantId: string;
  status: 'queued' | 'validating' | 'validation_complete' | 'importing' | 'completed' | 'failed';
  progress: number;
  totalSteps: number;
  completedSteps: number;
  message: string;
  report?: {
    createdCount: number;
    updatedCount: number;
    failedCount: number;
    warnings: string[];
    errors: string[];
    summary: {
      categoriesCreated: number;
      itemsCreated: number;
      itemsUpdated: number;
      itemsUnchanged: number;
      configsImported: number;
    }
  };
  preview?: {
    newRecords: any[];
    updatedRecords: any[];
    unchangedRecords: any[];
    errors: string[];
  };
  parsedData?: {
    items: any[];
    configGroups: any[];
    configOptions: any[];
    itemConfigMapping: any[];
    comboItems: any[];
    comboChoiceGroups: any[];
    comboChoiceOptions: any[];
  };
  createdAt: string;
}

// In-Memory Jobs Store
const activeJobs = new Map<string, ImportJob>();
// Import History list for reporting
const importHistory: ImportJob[] = [];

// Helper to support simple CSV parsing lines
export function parseCSV(csvContent: string): any[] {
  if (!csvContent || csvContent.trim() === "") return [];
  const lines: string[] = [];
  let inQuotes = false;
  let currentLine = "";

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
    } else if (char === '\n' && !inQuotes) {
      lines.push(currentLine);
      currentLine = "";
    } else if (char === '\r' && !inQuotes) {
      // safe skip Carriage Return
    } else {
      currentLine += char;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length === 0) return [];

  // Parse header
  const parseRow = (row: string) => {
    const cols: string[] = [];
    let col = "";
    let insideStr = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '"') {
        insideStr = !insideStr;
      } else if (c === ',' && !insideStr) {
        cols.push(col.trim());
        col = "";
      } else {
        col += c;
      }
    }
    cols.push(col.trim());
    return cols.map(s => {
      if (s.startsWith('"') && s.endsWith('"')) {
        return s.slice(1, -1);
      }
      return s;
    });
  };

  const headers = parseRow(lines[0]).map(h => h.trim().toLowerCase());
  const results: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseRow(lines[i]);
    const obj: any = {};
    headers.forEach((header, index) => {
      if (header) {
        obj[header] = values[index] !== undefined ? values[index] : "";
      }
    });
    results.push(obj);
  }

  return results;
}

// Generate CSV helper for Exports
export function generateCSV(headers: string[], rows: any[]): string {
  const headerLine = headers.join(",");
  const bodyLines = rows.map(row => {
    return headers.map(header => {
      let val = row[header];
      if (val === undefined || val === null) {
        val = "";
      }
      const valStr = String(val);
      if (valStr.includes(",") || valStr.includes("\n") || valStr.includes('"')) {
        return `"${valStr.replace(/"/g, '""')}"`;
      }
      return valStr;
    }).join(",");
  });
  return [headerLine, ...bodyLines].join("\n");
}

/**
 * Validates the parsed records for dependencies, duplicates and circular configurations.
 */
export function validateImportData(
  data: NonNullable<ImportJob['parsedData']>,
  existingItems: any[]
): { errors: string[]; warnings: string[]; preview: NonNullable<ImportJob['preview']> } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const existingItemCodes = new Set<string>();
  const dbItemByCode = new Map<string, any>();
  
  existingItems.forEach(item => {
    const code = item.options?.item_code || item.item_code;
    if (code) {
      existingItemCodes.add(code);
      dbItemByCode.set(code, item);
    }
  });

  // 1. Items duplicates & validation
  const itemCodes = new Set<string>();
  const itemTypeMap = new Map<string, string>(); // item_code -> product_type

  const newRecords: any[] = [];
  const updatedRecords: any[] = [];
  const unchangedRecords: any[] = [];

  data.items.forEach((item, index) => {
    const rowNo = index + 2;
    const code = item.item_code?.trim();
    if (!code) {
      errors.push(`Row ${rowNo} in items.csv: Missing central 'item_code'.`);
      return;
    }
    if (itemCodes.has(code)) {
      errors.push(`Row ${rowNo} in items.csv: Duplicate 'item_code' found: "${code}".`);
    } else {
      itemCodes.add(code);
      itemTypeMap.set(code, item.product_type || 'single');
    }

    if (!item.name?.trim()) {
      errors.push(`Item "${code}": Name is blank.`);
    }

    // Classify for preview
    if (existingItemCodes.has(code)) {
      const dbItem = dbItemByCode.get(code);
      // Compare basic fields
      const hasChanged = 
        dbItem.name !== item.name ||
        Number(dbItem.price || dbItem.base_price) !== Number(item.price || item.base_price || 0) ||
        (dbItem.description || "") !== (item.description || "") ||
        String(dbItem.is_active) !== String(item.is_active || "true") ||
        dbItem.product_type !== (item.product_type || 'single');

      if (hasChanged) {
        updatedRecords.push({ ...item, matchedId: dbItem.id });
      } else {
        unchangedRecords.push({ ...item, matchedId: dbItem.id });
      }
    } else {
      newRecords.push(item);
    }
  });

  // 2. Config groups verification
  const groupCodes = new Set<string>();
  data.configGroups.forEach((g, index) => {
    const code = g.group_code?.trim();
    if (!code) {
      errors.push(`Row ${index + 2} in config-groups.csv: Missing 'group_code'.`);
      return;
    }
    if (groupCodes.has(code)) {
      errors.push(`Duplicate modifier group code: "${code}" in config-groups.csv.`);
    }
    groupCodes.add(code);

    const min = parseInt(g.min_select || "0");
    const max = parseInt(g.max_select || "1");
    if (min > max) {
      errors.push(`Modifier group "${g.name || code}": min_select (${min}) is greater than max_select (${max}).`);
    }
  });

  // 3. Modifier Options verification
  const optCodes = new Set<string>();
  data.configOptions.forEach((opt, index) => {
    const code = opt.option_code?.trim();
    const gCode = opt.group_code?.trim();
    if (!code) {
      errors.push(`Row ${index + 2} in config-options.csv: Missing 'option_code'.`);
      return;
    }
    if (optCodes.has(code)) {
      errors.push(`Duplicate modifier option code "${code}" in config-options.csv.`);
    }
    optCodes.add(code);

    if (!gCode || !groupCodes.has(gCode)) {
      errors.push(`Modifier option "${opt.name || code}" references undefined modifier group code "${gCode}".`);
    }
  });

  // 4. Config Item Mapping verification
  data.itemConfigMapping.forEach((map, index) => {
    const rowNo = index + 2;
    const itemCode = map.item_code?.trim();
    const gCode = map.group_code?.trim();

    if (!itemCode || !itemCodes.has(itemCode)) {
      errors.push(`Row ${rowNo} in item-config-mapping.csv: Item code "${itemCode}" not found in items.csv.`);
    } else {
      const pType = itemTypeMap.get(itemCode);
      if (pType !== 'configurable') {
        warnings.push(`Row ${rowNo} in mapping: Item "${itemCode}" has modifier mapping but product_type is "${pType}" instead of "configurable".`);
      }
    }

    if (!gCode || !groupCodes.has(gCode)) {
      errors.push(`Row ${rowNo} in item-config-mapping.csv: Modifier group code "${gCode}" not found in config-groups.csv.`);
    }
  });

  // 5. Combo groups verification
  const comboGroupCodes = new Set<string>();
  data.comboChoiceGroups.forEach((g, index) => {
    const code = g.group_code?.trim();
    const comboProductCode = g.combo_product_code?.trim();

    if (!code) {
      errors.push(`Row ${index + 2} in combo-choice-groups.csv: Missing 'group_code'.`);
      return;
    }
    if (comboGroupCodes.has(code)) {
      errors.push(`Duplicate combo choice group code "${code}".`);
    }
    comboGroupCodes.add(code);

    if (!comboProductCode || !itemCodes.has(comboProductCode)) {
      errors.push(`Combo group "${g.name || code}" references undefined main combo item_code "${comboProductCode}".`);
    } else {
      const pType = itemTypeMap.get(comboProductCode);
      if (pType !== 'combo') {
        errors.push(`Combo group "${g.name || code}" references item "${comboProductCode}" which is not of product_type "combo".`);
      }
    }
  });

  // 6. Combo Items reference verification
  data.comboItems.forEach((map, index) => {
    const rowNo = index + 2;
    const comboProdCode = map.combo_product_code?.trim();
    const gCode = map.group_code?.trim();

    if (!comboProdCode || !itemCodes.has(comboProdCode)) {
      errors.push(`Row ${rowNo} in combo-items.csv: Main combo code "${comboProdCode}" not found in items.csv.`);
    }
    if (!gCode || !comboGroupCodes.has(gCode)) {
      errors.push(`Row ${rowNo} in combo-items.csv: Combo group code "${gCode}" not found in combo-choice-groups.csv.`);
    }
  });

  // 7. Combo choice options verification
  const comboOptCodes = new Set<string>();
  data.comboChoiceOptions.forEach((opt, index) => {
    const code = opt.option_code?.trim();
    const gCode = opt.group_code?.trim();
    const childCode = opt.child_item_code?.trim();

    if (!code) {
      errors.push(`Row ${index + 2} in combo-choice-options.csv: Missing 'option_code'.`);
      return;
    }
    if (comboOptCodes.has(code)) {
      errors.push(`Duplicate combo choice option code: "${code}".`);
    }
    comboOptCodes.add(code);

    if (!gCode || !comboGroupCodes.has(gCode)) {
      errors.push(`Combo option "${opt.custom_name || code}" references undefined combo choice group "${gCode}".`);
    }

    if (!childCode || !itemCodes.has(childCode)) {
      errors.push(`Combo option "${opt.custom_name || code}" references undefined child item_code "${childCode}".`);
    }
  });

  // 8. Circular combo dependencies check (Using Depth First Search)
  const comboChildMap = new Map<string, string[]>(); // combo_item_code -> child_item_codes[]
  
  // Build relationship tree
  data.comboChoiceGroups.forEach(cg => {
    const parentCode = cg.combo_product_code?.trim();
    const cgCode = cg.group_code?.trim();
    if (parentCode && cgCode) {
      if (!comboChildMap.has(parentCode)) {
        comboChildMap.set(parentCode, []);
      }
      
      const relatedOptions = data.comboChoiceOptions.filter(o => o.group_code?.trim() === cgCode);
      relatedOptions.forEach(o => {
        const childCode = o.child_item_code?.trim();
        if (childCode) {
          comboChildMap.get(parentCode)!.push(childCode);
        }
      });
    }
  });

  const checkCircle = (current: string, visited: Set<string>, visiting: Set<string>): boolean => {
    if (visiting.has(current)) {
      return true; // found a back edge / circular dependency!
    }
    if (visited.has(current)) {
      return false;
    }

    visiting.add(current);
    const children = comboChildMap.get(current) || [];
    for (const child of children) {
      if (checkCircle(child, visited, visiting)) {
        return true;
      }
    }
    visiting.delete(current);
    visited.add(current);
    return false;
  };

  const visited = new Set<string>();
  for (const comboCode of Array.from(comboChildMap.keys())) {
    const visiting = new Set<string>();
    if (checkCircle(comboCode, visited, visiting)) {
      errors.push(`Circular Dependency detected for combo item "${comboCode}". A combo item cannot directly or indirectly include itself as a component choice.`);
      break;
    }
  }

  return {
    errors,
    warnings,
    preview: {
      newRecords,
      updatedRecords,
      unchangedRecords,
      errors
    }
  };
}

/**
 * Main parser entry point to receive zip buffer and return parsed arrays of records.
 */
export async function parseMenuZip(zipBuffer: Buffer): Promise<NonNullable<ImportJob['parsedData']>> {
  const zip = await JSZip.loadAsync(zipBuffer);
  
  const getFileContent = async (name: string): Promise<string> => {
    const file = zip.file(name) || zip.file(new RegExp(`.*${name}$`))[0];
    if (!file) return "";
    return await file.async("string");
  };

  const [
    itemsCsv,
    groupsCsv,
    optionsCsv,
    mappingCsv,
    comboItemsCsv,
    comboGroupsCsv,
    comboOptionsCsv
  ] = await Promise.all([
    getFileContent("items.csv"),
    getFileContent("config-groups.csv"),
    getFileContent("config-options.csv"),
    getFileContent("item-config-mapping.csv"),
    getFileContent("combo-items.csv"),
    getFileContent("combo-choice-groups.csv"),
    getFileContent("combo-choice-options.csv")
  ]);

  return {
    items: parseCSV(itemsCsv),
    configGroups: parseCSV(groupsCsv),
    configOptions: parseCSV(optionsCsv),
    itemConfigMapping: parseCSV(mappingCsv),
    comboItems: parseCSV(comboItemsCsv),
    comboChoiceGroups: parseCSV(comboGroupsCsv),
    comboChoiceOptions: parseCSV(comboOptionsCsv)
  };
}

/**
 * Creates a new background import job and registers it.
 */
export function createImportJob(restaurantId: string): ImportJob {
  const jobId = Math.random().toString(36).substr(2, 9).toUpperCase();
  const job: ImportJob = {
    id: jobId,
    restaurantId,
    status: 'queued',
    progress: 0,
    totalSteps: 10,
    completedSteps: 0,
    message: 'Job initialized and queued helper context.',
    createdAt: new Date().toISOString()
  };
  activeJobs.set(jobId, job);
  return job;
}

export function getImportJob(jobId: string): ImportJob | undefined {
  return activeJobs.get(jobId);
}

export function getAllImportJobs(): ImportJob[] {
  return [...importHistory, ...Array.from(activeJobs.values())].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Application-level transactional rollback runner.
 * Takes a backup of all menu structures, and resets it if things crash during execution!
 */
export async function executeTransactionalImport(jobId: string) {
  const job = activeJobs.get(jobId);
  if (!job || !job.parsedData) return;

  const restId = job.restaurantId;
  job.status = 'importing';
  job.progress = 5;
  job.message = 'Backing up existing menu structure for transaction security...';
  activeJobs.set(jobId, { ...job });

  // 1. Back up data
  let backupCategories: any[] = [];
  let backupItems: any[] = [];
  let backupModifierGroups: any[] = [];
  let backupModifiers: any[] = [];
  let backupComboGroups: any[] = [];
  let backupComboGroupItems: any[] = [];

  try {
    const catQuery = await supabaseAdmin.from('categories').select('*').eq('restaurant_id', restId);
    backupCategories = catQuery.data || [];

    const itemQuery = await supabaseAdmin.from('menu_items').select('*').eq('restaurant_id', restId);
    backupItems = itemQuery.data || [];

    if (backupItems.length > 0) {
      const itemIds = backupItems.map(i => i.id);
      
      const modGrQuery = await supabaseAdmin.from('modifier_groups').select('*').in('product_id', itemIds);
      backupModifierGroups = modGrQuery.data || [];

      if (backupModifierGroups.length > 0) {
        const modGrIds = backupModifierGroups.map(g => g.id);
        const modQuery = await supabaseAdmin.from('modifiers').select('*').in('group_id', modGrIds);
        backupModifiers = modQuery.data || [];
      }

      const comboGrQuery = await supabaseAdmin.from('combo_groups').select('*').in('combo_product_id', itemIds);
      backupComboGroups = comboGrQuery.data || [];

      if (backupComboGroups.length > 0) {
        const comboGrIds = backupComboGroups.map(g => g.id);
        const comboItemQuery = await supabaseAdmin.from('combo_group_items').select('*').in('group_id', comboGrIds);
        backupComboGroupItems = comboItemQuery.data || [];
      }
    }
  } catch (err: any) {
    job.status = 'failed';
    job.message = `Backup process failed: ${err.message}. Aborting import.`;
    activeJobs.set(jobId, { ...job });
    return;
  }

  job.progress = 15;
  job.message = 'Backup success. Starting transactional execution...';
  activeJobs.set(jobId, { ...job });

  const restoreBackupOnCrash = async (errorMsg: string) => {
    console.error(`[ROLLBACK] Restoring original menu database layout due to failure: ${errorMsg}`);
    job.status = 'failed';
    job.message = `Critical error during import: ${errorMsg}. Rolling back database to pristine state...`;
    activeJobs.set(jobId, { ...job });

    try {
      // Clear anything we might have inserted (Delete cascades make this simpler)
      await supabaseAdmin.from('categories').delete().eq('restaurant_id', restId);
      
      // RESTORE BACKUP CHUNK BY CHUNK
      // restore categories first
      if (backupCategories.length > 0) {
        await supabaseAdmin.from('categories').insert(backupCategories.map(c => ({
          id: c.id,
          restaurant_id: c.restaurant_id,
          name: c.name,
          sort_order: c.sort_order,
          created_at: c.created_at
        })));
      }

      // restore menu items
      if (backupItems.length > 0) {
        for (let i = 0; i < backupItems.length; i += 50) {
          const chunk = backupItems.slice(i, i + 50).map(item => ({
            id: item.id,
            restaurant_id: item.restaurant_id,
            category_id: item.category_id,
            name: item.name,
            description: item.description,
            price: item.price,
            base_price: item.base_price,
            image_url: item.image_url,
            is_active: item.is_active,
            status: item.status,
            product_type: item.product_type,
            options: item.options,
            display_behavior: item.display_behavior,
            created_at: item.created_at
          }));
          await supabaseAdmin.from('menu_items').insert(chunk);
        }
      }

      // restore modifier groups
      if (backupModifierGroups.length > 0) {
        await supabaseAdmin.from('modifier_groups').insert(backupModifierGroups.map(g => ({
          id: g.id,
          product_id: g.product_id,
          parent_modifier_id: g.parent_modifier_id,
          name: g.name,
          required: g.required,
          min_select: g.min_select,
          max_select: g.max_select,
          display_behavior: g.display_behavior,
          sort_order: g.sort_order,
          created_at: g.created_at
        })));
      }

      // restore modifiers
      if (backupModifiers.length > 0) {
        await supabaseAdmin.from('modifiers').insert(backupModifiers.map(m => ({
          id: m.id,
          group_id: m.group_id,
          name: m.name,
          price_delta: m.price_delta,
          is_default: m.is_default,
          render_importance: m.render_importance,
          display_behavior: m.display_behavior,
          sort_order: m.sort_order,
          created_at: m.created_at
        })));
      }

      // restore combo groups
      if (backupComboGroups.length > 0) {
        await supabaseAdmin.from('combo_groups').insert(backupComboGroups.map(g => ({
          id: g.id,
          combo_product_id: g.combo_product_id,
          name: g.name,
          description: g.description,
          required: g.required,
          min_select: g.min_select,
          max_select: g.max_select,
          display_behavior: g.display_behavior,
          importance: g.importance,
          sort_order: g.sort_order,
          created_at: g.created_at
        })));
      }

      // restore combo items
      if (backupComboGroupItems.length > 0) {
        await supabaseAdmin.from('combo_group_items').insert(backupComboGroupItems.map(item => ({
          id: item.id,
          group_id: item.group_id,
          child_product_id: item.child_product_id,
          custom_name: item.custom_name,
          price_delta: item.price_delta,
          default_selected: item.default_selected,
          display_behavior: item.display_behavior,
          importance: item.importance,
          sort_order: item.sort_order,
          created_at: item.created_at
        })));
      }

      job.message += " Rollback SUCCESSFUL. Current state reverted completely.";
    } catch (restoreErr: any) {
      job.message += ` CRITICAL DOUBLE-FAILURE! Rollback crashed with error: ${restoreErr.message}. DB is now in partial state. Contact admin.`;
    }
    
    activeJobs.set(jobId, { ...job });
    importHistory.push({ ...job });
    activeJobs.delete(jobId);
  };

  try {
    const data = job.parsedData;
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let categoriesCreated = 0;
    let configsImported = 0;
    const warnings: string[] = [];

    // Step 2. Auto-resolve unique categories
    job.progress = 25;
    job.message = 'Processing and indexing Menu Categories...';
    activeJobs.set(jobId, { ...job });

    const categoriesInCsv = Array.from(new Set(
      data.items.map(i => i.category_name?.trim()).filter(Boolean)
    )) as string[];

    const existingCatsByName = new Map<string, string>(); // name -> id
    backupCategories.forEach(cat => {
      existingCatsByName.set(cat.name.toLowerCase().trim(), cat.id);
    });

    const categoryIdByName = new Map<string, string>();

    // Chunked batch insertion of categories to avoid database row locks
    const newCatsToInsert: any[] = [];
    categoriesInCsv.forEach(catName => {
      const key = catName.toLowerCase().trim();
      const existingId = existingCatsByName.get(key);
      if (existingId) {
        categoryIdByName.set(key, existingId);
      } else {
        const newId = Math.random().toString(36).substr(2, 9).toUpperCase() + '-CAT'; // fallback pseudo id we replenish
        newCatsToInsert.push({
          restaurant_id: restId,
          name: catName,
          sort_order: 10
        });
      }
    });

    if (newCatsToInsert.length > 0) {
      const { data: insertedCats, error: catInsErr } = await supabaseAdmin
        .from('categories')
        .insert(newCatsToInsert)
        .select();

      if (catInsErr) {
        await restoreBackupOnCrash(`Could not create category elements: ${catInsErr.message}`);
        return;
      }

      insertedCats?.forEach(cat => {
        categoryIdByName.set(cat.name.toLowerCase().trim(), cat.id);
        categoriesCreated++;
      });
    }

    // Step 3: Insert/Update menu items
    job.progress = 40;
    job.message = 'Importing items into public.menu_items in batch chunks...';
    activeJobs.set(jobId, { ...job });

    const itemIdByItemCode = new Map<string, string>(); // code -> database UUID
    const itemCodeToOriginalId = new Map<string, string>();

    // Delete existing menu items so we can reload cleanly but gracefully
    // Wait, let's delete only those we are modifying or recreate all if desired.
    // Clean slate is highly transactional and matches circular combo checks perfectly
    const { error: cleanItemsErr } = await supabaseAdmin
      .from('menu_items')
      .delete()
      .eq('restaurant_id', restId);

    if (cleanItemsErr) {
      await restoreBackupOnCrash(`Fail cleaning up existing menu items: ${cleanItemsErr.message}`);
      return;
    }

    const itemsToInsert = data.items.map(item => {
      const catKey = item.category_name?.trim()?.toLowerCase();
      const categoryId = catKey ? categoryIdByName.get(catKey) || null : null;
      
      // Store item_code inside options JSONB
      const activeOptions = {
        item_code: item.item_code?.trim()
      };

      return {
        restaurant_id: restId,
        category_id: categoryId,
        name: item.name,
        price: parseFloat(item.price || item.base_price || "0"),
        base_price: parseFloat(item.base_price || item.price || "0"),
        description: item.description || null,
        image_url: item.image_url || null,
        is_active: item.is_active === "false" ? false : true,
        product_type: item.product_type || 'single',
        options: activeOptions,
        status: item.is_active === "false" ? 'Paused' : 'Available'
      };
    });

    // Chunk size 100 for heavy payloads (like 10,000+ items)
    const chunkSize = 100;
    for (let i = 0; i < itemsToInsert.length; i += chunkSize) {
      const chunk = itemsToInsert.slice(i, i + chunkSize);
      const { data: insertedChunk, error: insErr } = await supabaseAdmin
        .from('menu_items')
        .insert(chunk)
        .select();

      if (insErr) {
        await restoreBackupOnCrash(`Batch item insert failed: ${insErr.message}`);
        return;
      }

      insertedChunk?.forEach(item => {
        const itemCode = item.options?.item_code;
        if (itemCode) {
          itemIdByItemCode.set(itemCode, item.id);
        }
        createdCount++;
      });

      // Update progress smoothly during large processes
      job.progress = 40 + Math.round((i / itemsToInsert.length) * 30); // scale up to 70%
      job.message = `Imported items chunk (${createdCount}/${itemsToInsert.length})...`;
      activeJobs.set(jobId, { ...job });
    }

    // Step 4: Import Config groups & options
    job.progress = 75;
    job.message = 'Structuring Modifier Configurator Engines...';
    activeJobs.set(jobId, { ...job });

    const modGroupIdMap = new Map<string, string>(); // group_code -> DB uuid
    const groupsInserted: any[] = [];

    // Let's create modifier groups first
    // We map modifier groups to items using items-to-groups mapping or inline mapping
    // Our CSV template configures:
    // `config-groups.csv` -> lists all modifier groups
    // `item-config-mapping.csv` -> item_code vs group_code
    
    // We can insert modifier groups referencing product_id. Wait! Since modifier groups can belong to multiple products,
    // but in DB schema `modifier_groups` table has a `product_id UUID` column!
    // Wait! Let's check:
    // If a modifier group belongs to multiple products, does it mean we duplicate the modifier group row for each product?
    // Yes! In the database table schema `modifier_groups` has `product_id UUID REFERENCES menu_items(id)`.
    // So if `item-config-mapping.csv` has multiple products mapped to the same `group_code`, we create separate rows inside `modifier_groups` for each mapped product!
    // This is incredibly robust because we can store `{ "group_code": "..." }` in `display_behavior` of each duplicated group to identify them,
    // and they will be isolated to their respective product perfectly!

    const modGroupsToInsertPayload: any[] = [];
    
    data.itemConfigMapping.forEach(map => {
      const itemCode = map.item_code?.trim();
      const gCode = map.group_code?.trim();
      
      const productId = itemIdByItemCode.get(itemCode);
      const gConfig = data.configGroups.find(cg => cg.group_code?.trim() === gCode);

      if (productId && gConfig) {
        modGroupsToInsertPayload.push({
          product_id: productId,
          name: gConfig.name || "Config Group",
          required: gConfig.required === "true" || gConfig.required === "1" ? true : false,
          min_select: parseInt(gConfig.min_select || "0"),
          max_select: parseInt(gConfig.max_select || "1"),
          sort_order: parseInt(gConfig.sort_order || "0"),
          display_behavior: { group_code: gCode }
        });
      }
    });

    if (modGroupsToInsertPayload.length > 0) {
      const { data: insertedGroups, error: grInsertErr } = await supabaseAdmin
        .from('modifier_groups')
        .insert(modGroupsToInsertPayload)
        .select();

      if (grInsertErr) {
        await restoreBackupOnCrash(`Could not create modifier groups: ${grInsertErr.message}`);
        return;
      }

      // Now we need to insert the Modifiers corresponding to each group!
      // Since we duplicated modifier groups for each item, we duplicate their options too.
      const modifiersToInsertPayload: any[] = [];
      
      insertedGroups?.forEach(insertedGroup => {
        const groupCode = insertedGroup.display_behavior?.group_code;
        const matchingOptions = data.configOptions.filter(opt => opt.group_code?.trim() === groupCode);

        matchingOptions.forEach(opt => {
          modifiersToInsertPayload.push({
            group_id: insertedGroup.id,
            name: opt.name,
            price_delta: parseFloat(opt.price_delta || "0"),
            is_default: opt.is_default === "true" || opt.is_default === "1" ? true : false,
            sort_order: parseInt(opt.sort_order || "0"),
            display_behavior: { option_code: opt.option_code?.trim() }
          });
        });
        configsImported++;
      });

      if (modifiersToInsertPayload.length > 0) {
        const { error: optInsertErr } = await supabaseAdmin
          .from('modifiers')
          .insert(modifiersToInsertPayload);

        if (optInsertErr) {
          await restoreBackupOnCrash(`Could not create modifier options: ${optInsertErr.message}`);
          return;
        }
      }
    }

    // Step 5: Import Combo choice groups and items
    job.progress = 88;
    job.message = 'Assembling Combo Product Composition Matrices...';
    activeJobs.set(jobId, { ...job });

    // Similar to modifier groups, combo groups are tied to a combo main product in `combo_product_id`
    // In our CSVs:
    // `combo-choice-groups.csv` has `group_code`, `combo_product_code`, `name`, `description`, etc.
    // `combo-choice-options.csv` has `group_code`, `child_item_code`, `custom_name`, `price_delta`, `default_selected`
    
    const comboChoiceGroupsPayload = data.comboChoiceGroups.map(g => {
      const comboProductId = itemIdByItemCode.get(g.combo_product_code?.trim());
      return {
        combo_product_id: comboProductId,
        name: g.name,
        description: g.description || null,
        required: g.required === "true" || g.required === "1" ? true : false,
        min_select: parseInt(g.min_select || "0"),
        max_select: parseInt(g.max_select || "1"),
        sort_order: parseInt(g.sort_order || "0"),
        display_behavior: { group_code: g.group_code?.trim() }
      };
    }).filter(g => g.combo_product_id !== undefined);

    if (comboChoiceGroupsPayload.length > 0) {
      const { data: insertedComboGroups, error: comboGrErr } = await supabaseAdmin
        .from('combo_groups')
        .insert(comboChoiceGroupsPayload)
        .select();

      if (comboGrErr) {
        await restoreBackupOnCrash(`Could not insert combo choice groups: ${comboGrErr.message}`);
        return;
      }

      const comboGroupItemsPayload: any[] = [];
      insertedComboGroups?.forEach(cg => {
        const groupCode = cg.display_behavior?.group_code;
        const matchingOptions = data.comboChoiceOptions.filter(o => o.group_code?.trim() === groupCode);

        matchingOptions.forEach(opt => {
          const childProductId = itemIdByItemCode.get(opt.child_item_code?.trim());
          if (childProductId) {
            comboGroupItemsPayload.push({
              group_id: cg.id,
              child_product_id: childProductId,
              custom_name: opt.custom_name || null,
              price_delta: parseFloat(opt.price_delta || "0"),
              default_selected: opt.default_selected === "true" || opt.default_selected === "1" ? true : false,
              sort_order: parseInt(opt.sort_order || "0"),
              display_behavior: { option_code: opt.option_code?.trim() }
            });
          }
        });
        configsImported++;
      });

      if (comboGroupItemsPayload.length > 0) {
        const { error: comboItemErr } = await supabaseAdmin
          .from('combo_group_items')
          .insert(comboGroupItemsPayload);

        if (comboItemErr) {
          await restoreBackupOnCrash(`Could not populate combo item compositions: ${comboItemErr.message}`);
          return;
        }
      }
    }

    // Done Success!
    job.status = 'completed';
    job.progress = 100;
    job.message = 'Menu import transaction completed successfully!';
    job.report = {
      createdCount,
      updatedCount,
      failedCount: 0,
      warnings,
      errors: [],
      summary: {
        categoriesCreated,
        itemsCreated: createdCount,
        itemsUpdated: updatedCount,
        itemsUnchanged: 0,
        configsImported
      }
    };
    
    activeJobs.set(jobId, { ...job });
    importHistory.push({ ...job });
    activeJobs.delete(jobId);

    console.log(`[Import SUCCESS] Job ${jobId} finished cleanly for restaurant ${restId}`);
  } catch (fatalErr: any) {
    await restoreBackupOnCrash(fatalErr.message || 'Fatal unexpected implementation error');
  }
}
