import { indexedDbStorage } from '../lib/indexedDbStorage';
import { guestSupabase as supabase } from '../lib/supabase';
import { Order, OrderItem, ThermalPrinter, PrinterRoute, PrintJob, KOTPayload, KOTItem, ProductSelection } from '../types';

interface ExtendedOrderItem extends OrderItem {
  product?: { categoryId?: string };
  categoryId?: string;
  configuration?: ProductSelection;
}

interface ExtendedOrder extends Order {
  specialInstructions?: string;
}

interface DbMenuItem {
  id: string;
  category_id: string;
}

class PrinterService {
  private printersKey = 'kot_printers';
  private routesKey = 'kot_printer_routes';
  private jobsKey = 'kot_print_jobs';

  // --- PRINTERS MANAGEMENT ---
  async getPrinters(restaurantId: string): Promise<ThermalPrinter[]> {
    try {
      const { data, error } = await supabase
        .from('printers')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (error) throw error;
      
      const parsedPrinters: ThermalPrinter[] = (data || []).map(p => ({
        id: p.id,
        restaurantId: p.restaurant_id,
        name: p.name,
        type: p.type as 'thermal' | 'star' | 'browser',
        interfaceType: p.interface_type as 'network' | 'usb' | 'bluetooth' | 'browser',
        connectionAddress: p.connection_address,
        status: p.status as 'online' | 'offline',
        isActive: p.is_active,
        createdAt: p.created_at,
      }));

      // Cache locally
      await indexedDbStorage.setItem(`${this.printersKey}_${restaurantId}`, parsedPrinters);
      return parsedPrinters;
    } catch (err) {
      console.warn('[PrinterService] Supabase read failed, calling IndexedDB backup:', err);
      const cached = await indexedDbStorage.getItem<ThermalPrinter[]>(`${this.printersKey}_${restaurantId}`);
      return cached || this.getDefaultPrinters(restaurantId);
    }
  }

  async savePrinter(restaurantId: string, printer: Partial<ThermalPrinter>): Promise<ThermalPrinter> {
    const isNew = !printer.id;
    const printerPayload = {
      restaurant_id: restaurantId,
      name: printer.name || 'Unnamed Printer',
      type: printer.type || 'browser',
      interface_type: printer.interfaceType || 'browser',
      connection_address: printer.connectionAddress || '',
      status: printer.status || 'online',
      is_active: printer.isActive !== false,
      ...(printer.id ? { id: printer.id } : {})
    };

    try {
      let result;
      if (isNew) {
        const { data, error } = await supabase
          .from('printers')
          .insert(printerPayload)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from('printers')
          .update(printerPayload)
          .eq('id', printer.id)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      const formatted: ThermalPrinter = {
        id: result.id,
        restaurantId: result.restaurant_id,
        name: result.name,
        type: result.type,
        interfaceType: result.interface_type,
        connectionAddress: result.connection_address,
        status: result.status,
        isActive: result.is_active,
        createdAt: result.created_at
      };

      // Refresh memory cache
      await this.refreshLocalPrintersCache(restaurantId);
      return formatted;
    } catch (err) {
      console.warn('[PrinterService] Save failing on Supabase, writing to dynamic local backup:', err);
      // Client-side local key fallback
      const cached = await indexedDbStorage.getItem<ThermalPrinter[]>(`${this.printersKey}_${restaurantId}`) || [];
      const updatedPrinter: ThermalPrinter = {
        id: printer.id || crypto.randomUUID(),
        restaurantId,
        name: printer.name || 'Local Printer',
        type: printer.type || 'browser',
        interfaceType: printer.interfaceType || 'browser',
        connectionAddress: printer.connectionAddress || '',
        status: printer.status || 'online',
        isActive: printer.isActive !== false,
        createdAt: printer.createdAt || new Date().toISOString()
      };

      let newCache;
      if (isNew) {
        newCache = [...cached, updatedPrinter];
      } else {
        newCache = cached.map(p => p.id === printer.id ? updatedPrinter : p);
      }

      await indexedDbStorage.setItem(`${this.printersKey}_${restaurantId}`, newCache);
      return updatedPrinter;
    }
  }

  async deletePrinter(restaurantId: string, printerId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('printers')
        .delete()
        .eq('id', printerId);
      if (error) throw error;
    } catch (err) {
      console.warn('[PrinterService] Delete failing on Supabase, performing on Local cache:', err);
    } finally {
      const cached = await indexedDbStorage.getItem<ThermalPrinter[]>(`${this.printersKey}_${restaurantId}`) || [];
      const filtered = cached.filter(p => p.id !== printerId);
      await indexedDbStorage.setItem(`${this.printersKey}_${restaurantId}`, filtered);
      
      // Also delete routes related to this printer
      const cachedRoutes = await indexedDbStorage.getItem<PrinterRoute[]>(`${this.routesKey}_${restaurantId}`) || [];
      const filteredRoutes = cachedRoutes.filter(r => r.printerId !== printerId);
      await indexedDbStorage.setItem(`${this.routesKey}_${restaurantId}`, filteredRoutes);
    }
  }

  private getDefaultPrinters(restaurantId: string): ThermalPrinter[] {
    return [
      {
        id: 'browser-default',
        restaurantId,
        name: 'Main Kitchen Printer (Default)',
        type: 'browser',
        interfaceType: 'browser',
        connectionAddress: 'Main Station Roll',
        status: 'online',
        isActive: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'drinks-printer-default',
        restaurantId,
        name: 'Bar Printer (Drinks)',
        type: 'browser',
        interfaceType: 'browser',
        connectionAddress: 'Bar Roll',
        status: 'online',
        isActive: true,
        createdAt: new Date().toISOString()
      }
    ];
  }

  private async refreshLocalPrintersCache(restaurantId: string): Promise<void> {
    try {
      const { data } = await supabase.from('printers').select('*').eq('restaurant_id', restaurantId);
      if (data) {
        const formatted: ThermalPrinter[] = data.map(p => ({
          id: p.id,
          restaurantId: p.restaurant_id,
          name: p.name,
          type: p.type,
          interfaceType: p.interface_type,
          connectionAddress: p.connection_address,
          status: p.status,
          isActive: p.is_active,
          createdAt: p.created_at
        }));
        await indexedDbStorage.setItem(`${this.printersKey}_${restaurantId}`, formatted);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // --- PRINTER ROUTES ---
  async getPrinterRoutes(restaurantId: string): Promise<PrinterRoute[]> {
    try {
      const { data, error } = await supabase
        .from('printer_routes')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (error) throw error;

      const formatted: PrinterRoute[] = (data || []).map(r => ({
        id: r.id,
        restaurantId: r.restaurant_id,
        printerId: r.printer_id,
        categoryId: r.category_id,
        createdAt: r.created_at
      }));

      await indexedDbStorage.setItem(`${this.routesKey}_${restaurantId}`, formatted);
      return formatted;
    } catch (err) {
      console.warn('[PrinterService] Supabase routes fetch failed, loading IndexedDB backup:', err);
      const cached = await indexedDbStorage.getItem<PrinterRoute[]>(`${this.routesKey}_${restaurantId}`);
      return cached || [];
    }
  }

  async savePrinterRoute(restaurantId: string, printerId: string, categoryId: string): Promise<PrinterRoute> {
    const routePayload = {
      restaurant_id: restaurantId,
      printer_id: printerId,
      category_id: categoryId
    };

    try {
      const { data, error } = await supabase
        .from('printer_routes')
        .insert(routePayload)
        .select()
        .single();

      if (error) throw error;

      const formatted: PrinterRoute = {
        id: data.id,
        restaurantId: data.restaurant_id,
        printerId: data.printer_id,
        categoryId: data.category_id,
        createdAt: data.created_at
      };

      await this.refreshLocalRoutesCache(restaurantId);
      return formatted;
    } catch (err) {
      console.warn('[PrinterService] Route save failed on Supabase, fallback to local indexing:', err);
      const cached = await indexedDbStorage.getItem<PrinterRoute[]>(`${this.routesKey}_${restaurantId}`) || [];
      
      // Delete existing duplicate (ensure uniqueness)
      const filtered = cached.filter(r => !(r.printerId === printerId && r.categoryId === categoryId));
      
      const newRoute: PrinterRoute = {
        id: crypto.randomUUID(),
        restaurantId,
        printerId,
        categoryId,
        createdAt: new Date().toISOString()
      };

      await indexedDbStorage.setItem(`${this.routesKey}_${restaurantId}`, [...filtered, newRoute]);
      return newRoute;
    }
  }

  async deletePrinterRoute(restaurantId: string, routeId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('printer_routes')
        .delete()
        .eq('id', routeId);
      if (error) throw error;
    } catch (err) {
      console.warn('[PrinterService] Route delete failed on Supabase:', err);
    } finally {
      const cached = await indexedDbStorage.getItem<PrinterRoute[]>(`${this.routesKey}_${restaurantId}`) || [];
      const filtered = cached.filter(r => r.id !== routeId);
      await indexedDbStorage.setItem(`${this.routesKey}_${restaurantId}`, filtered);
    }
  }

  private async refreshLocalRoutesCache(restaurantId: string): Promise<void> {
    try {
      const { data } = await supabase.from('printer_routes').select('*').eq('restaurant_id', restaurantId);
      if (data) {
        const formatted: PrinterRoute[] = data.map(r => ({
          id: r.id,
          restaurantId: r.restaurant_id,
          printerId: r.printer_id,
          categoryId: r.category_id,
          createdAt: r.created_at
        }));
        await indexedDbStorage.setItem(`${this.routesKey}_${restaurantId}`, formatted);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // --- KOT ROUTING & AUTO PRINT CREATION ENGINE ---
  /**
   * Evaluates order items, splits them by category into correct station printer, 
   * creates Print Queue Jobs (Supabase first + DB retry local cache)
   */
  async routeAndQueueOrder(restaurantId: string, order: Order, notes?: string, autoPrint = false): Promise<PrintJob[]> {
    try {
      console.log(`[PrinterService] Routing order ${order.id} (Table: ${order.tableName || order.tableId})`);
      
      // 1. Fetch printers and routes
      const printers = await this.getPrinters(restaurantId);
      const routes = await this.getPrinterRoutes(restaurantId);

      const activePrinters = printers.filter(p => p.isActive);

      // Create a map of category_id -> printer_id
      const routeMap = new Map<string, string>();
      routes.forEach(r => {
        routeMap.set(r.categoryId, r.printerId);
      });

      // Fetch menu items map from DB for precise menuItemId -> category_id resolution
      const itemCategoryMap = new Map<string, string>();
      try {
        const { data: dbItems, error: dbErr } = await supabase
          .from('menu_items')
          .select('id, category_id')
          .eq('restaurant_id', restaurantId);
        
        if (dbItems && !dbErr) {
          dbItems.forEach((it: DbMenuItem) => {
            if (it.id && it.category_id) {
              itemCategoryMap.set(it.id, it.category_id);
            }
          });
        }
      } catch (err) {
        console.warn('[PrinterService] Dynamic menu items map resolution failed, routing will use fallback selectors:', err);
      }

      // 2. Classify items by active printer
      const itemsByPrinter = new Map<string, OrderItem[]>();
      const unroutedItems: OrderItem[] = [];

      (order.items || []).forEach(item => {
        const itemAny = item as ExtendedOrderItem;
        const catId = itemCategoryMap.get(item.menuItemId) || itemAny.product?.categoryId || itemAny.categoryId || item.menuItemId;
        const mappedPrinterId = routeMap.get(catId);
        
        if (mappedPrinterId && activePrinters.some(p => p.id === mappedPrinterId)) {
          if (!itemsByPrinter.has(mappedPrinterId)) {
            itemsByPrinter.set(mappedPrinterId, []);
          }
          itemsByPrinter.get(mappedPrinterId)!.push(item);
        } else {
          unroutedItems.push(item);
        }
      });

      const printJobsToInsert: Partial<PrintJob>[] = [];
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });

      // Helper to map order details to KOT payload
      const makeKOTPayload = (stationItems: OrderItem[]): KOTPayload => {
        return {
          orderId: order.id.slice(0, 8).toUpperCase(),
          tableName: order.tableName || order.tableId.slice(-4).toUpperCase(),
          orderType: order.orderType || 'dine_in',
          time: timeStr,
          date: dateStr,
          items: stationItems.map(si => {
            // Extract options
            const modifiers: string[] = [];
            
            // From regular options structure
            if (Array.isArray(si.options)) {
              si.options.forEach(o => {
                modifiers.push(`+ ${o.valueName}`);
              });
            }

            // From rich customizable nested product selections
            const siAny = si as ExtendedOrderItem;
            const configurationSelection = si.selection || siAny.configuration;
            if (configurationSelection?.selections) {
              Object.values(configurationSelection.selections).forEach((selList) => {
                (selList || []).forEach(sel => {
                  modifiers.push(`+ ${sel.name}`);
                  if (sel.nestedSelections) {
                    Object.values(sel.nestedSelections).forEach((nestedList) => {
                      (nestedList || []).forEach(nSel => {
                        modifiers.push(`  + ${nSel.name}`);
                      });
                    });
                  }
                });
              });
            }

            return {
              id: si.id || si.menuItemId,
              name: si.name,
              quantity: si.quantity,
              modifiers: modifiers,
              specialInstructions: si.specialInstructions
            };
          }),
          notes: notes || (order as ExtendedOrder).specialInstructions || undefined
        };
      };

      // Create print job per printer
      itemsByPrinter.forEach((stationItems, printerId) => {
        const printerObj = activePrinters.find(p => p.id === printerId);
        printJobsToInsert.push({
          id: crypto.randomUUID(),
          restaurantId,
          orderId: order.id,
          printerId: printerId,
          idempotencyKey: `kot-${order.id}-${printerId}`,
          type: 'kot',
          status: 'pending',
          retries: 0,
          payload: makeKOTPayload(stationItems),
          reprintCount: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        });
      });

      // Handle unrouted items by sending them to a defaults fallback
      if (unroutedItems.length > 0) {
        // Find default browser printer or just first printer
        let defaultPrinter = activePrinters.find(p => p.type === 'browser') || activePrinters[0];
        
        // If absolutely no printers exist, create a virtual one to allow local popups/reprints
        const fallbackId = defaultPrinter?.id || 'browser-default';
        
        printJobsToInsert.push({
          id: crypto.randomUUID(),
          restaurantId,
          orderId: order.id,
          printerId: fallbackId,
          idempotencyKey: `kot-${order.id}-fallback`,
          type: 'kot',
          status: 'pending',
          retries: 0,
          payload: makeKOTPayload(unroutedItems),
          reprintCount: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        });
      }

      // 3. Write print jobs to DB / local queue
      const results: PrintJob[] = [];
      for (const pj of printJobsToInsert) {
        try {
          const { data, error } = await supabase
            .from('print_jobs')
            .insert({
              id: pj.id,
              restaurant_id: pj.restaurantId,
              order_id: pj.orderId,
              printer_id: pj.printerId === 'browser-default' || pj.printerId === 'drinks-printer-default' ? null : pj.printerId,
              idempotency_key: pj.idempotencyKey,
              type: pj.type,
              status: pj.status,
              retries: pj.retries,
              payload: pj.payload
            })
            .select()
            .single();

          if (error) {
            // Check for uniqueness constraint violation (idempotency safety check)
            if (error.code === '23505') {
              console.warn(`[PrinterService] Print job already queued securely (idempotency hit) for ${pj.idempotencyKey}`);
              continue;
            }
            throw error;
          }

          results.push({
            id: data.id,
            restaurantId: data.restaurant_id,
            orderId: data.order_id,
            printerId: data.printer_id || pj.printerId, // fallback to virtual id if null
            idempotencyKey: data.idempotency_key,
            type: data.type as 'kot' | 'receipt',
            status: data.status as 'pending' | 'printed' | 'failed',
            retries: data.retries,
            payload: data.payload,
            reprintCount: data.reprint_count,
            createdAt: data.created_at,
            updatedAt: data.updated_at
          });
        } catch (jobErr) {
          console.warn(`[PrinterService] Failed saving print job on server, saving to IndexedDB queue:`, jobErr);
          
          const fullJob: PrintJob = {
            id: pj.id!,
            restaurantId: pj.restaurantId!,
            orderId: pj.orderId!,
            printerId: pj.printerId,
            idempotencyKey: pj.idempotencyKey!,
            type: pj.type!,
            status: 'pending',
            retries: 0,
            payload: pj.payload!,
            reprintCount: 0,
            createdAt: pj.createdAt!,
            updatedAt: pj.updatedAt!
          };
          
          await this.saveLocalPrintJob(restaurantId, fullJob);
          results.push(fullJob);
        }
      }

      // Proactively process the jobs if browser printing is configured
      if (autoPrint) {
        this.triggerLocalBrowserPrints(restaurantId, results);
      }

      return results;
    } catch (topErr) {
      console.error('[PrinterService] Critical routeAndQueueOrder failure:', topErr);
      return [];
    }
  }

  // --- REPRINTING FEATURE ---
  async reprintKOT(restaurantId: string, jobId: string, staffNameOrEmail: string): Promise<PrintJob | null> {
    const now = new Date().toISOString();
    try {
      const { data: existingJob, error: fetchErr } = await supabase
        .from('print_jobs')
        .select('reprint_count')
        .eq('id', jobId)
        .single();
        
      if (fetchErr) throw fetchErr;
      const nextCount = (existingJob?.reprint_count || 0) + 1;

      const { data, error } = await supabase
        .from('print_jobs')
        .update({
          reprint_count: nextCount,
          reprinted_by: staffNameOrEmail,
          reprinted_at: now,
          status: 'pending' // Re-triggers background print observers
        })
        .eq('id', jobId)
        .select()
        .single();

      if (error) throw error;

      const formatted: PrintJob = {
        id: data.id,
        restaurantId: data.restaurant_id,
        orderId: data.order_id,
        printerId: data.printer_id,
        idempotencyKey: data.idempotency_key,
        type: data.type,
        status: data.status,
        retries: data.retries,
        payload: data.payload,
        reprintCount: data.reprint_count,
        reprintedBy: data.reprinted_by,
        reprintedAt: data.reprinted_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      };

      // Trigger the local fallback print explicitly
      this.triggerLocalBrowserPrint(restaurantId, formatted);
      return formatted;
    } catch (err) {
      console.warn('[PrinterService] Online reprint failed, falling back to local queue update:', err);
      const jobs = await this.getLocalPrintJobs(restaurantId);
      const jobIdx = jobs.findIndex(j => j.id === jobId);
      
      if (jobIdx !== -1) {
        const updated = {
          ...jobs[jobIdx],
          status: 'pending' as const,
          reprintCount: jobs[jobIdx].reprintCount + 1,
          reprintedBy: staffNameOrEmail,
          reprintedAt: now
        };
        jobs[jobIdx] = updated;
        await indexedDbStorage.setItem(`${this.jobsKey}_${restaurantId}`, jobs);
        this.triggerLocalBrowserPrint(restaurantId, updated);
        return updated;
      }
      return null;
    }
  }

  // --- LOCAL PRINT JOBS STORE (OFFLINE SECURE QUEUE) ---
  async getLocalPrintJobs(restaurantId: string): Promise<PrintJob[]> {
    const cached = await indexedDbStorage.getItem<PrintJob[]>(`${this.jobsKey}_${restaurantId}`);
    return cached || [];
  }

  async saveLocalPrintJob(restaurantId: string, job: PrintJob): Promise<void> {
    const cached = await this.getLocalPrintJobs(restaurantId);
    const existingIdx = cached.findIndex(j => j.id === job.id);
    if (existingIdx !== -1) {
      cached[existingIdx] = job;
    } else {
      cached.push(job);
    }
    await indexedDbStorage.setItem(`${this.jobsKey}_${restaurantId}`, cached);
  }

  async markJobPrinted(restaurantId: string, jobId: string): Promise<void> {
    try {
      await supabase
        .from('print_jobs')
        .update({ status: 'printed', updated_at: new Date().toISOString() })
        .eq('id', jobId);
    } catch (e) {
      console.warn('[PrinterService] Offline job printed update failed to sync:', e);
    } finally {
      const cached = await this.getLocalPrintJobs(restaurantId);
      const existingIdx = cached.findIndex(j => j.id === jobId);
      if (existingIdx !== -1) {
        cached[existingIdx].status = 'printed';
        cached[existingIdx].updatedAt = new Date().toISOString();
        await indexedDbStorage.setItem(`${this.jobsKey}_${restaurantId}`, cached);
      }
    }
  }

  // --- HTML THERMAL CHIT RENDERER ---
  renderKOTHtml(payload: KOTPayload): string {
    const itemsRows = payload.items.map(item => {
      const modifiersLines = (item.modifiers || []).map(m => 
        `<div style="font-size: 13px; color: #555; padding-left: 20px; font-weight: normal; margin-top: 1px;">${m}</div>`
      ).join('');

      const notesLine = item.specialInstructions 
        ? `<div style="font-size: 13px; color: #cc6600; font-family: monospace; padding-left: 20px; font-style: italic; margin-top: 2px;">* "${item.specialInstructions}"</div>`
        : '';

      return `
        <div style="margin-bottom: 12px; font-weight: bold; border-bottom: 1px dashed #f0f0f0; padding-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; font-size: 18px; width: 100%;">
            <span>${item.quantity}x ${item.name}</span>
          </div>
          ${modifiersLines}
          ${notesLine}
        </div>
      `;
    }).join('');

    const reprintNotice = (payload.reprintCount && payload.reprintCount > 0)
      ? `
        <div style="background: #000; color: #fff; text-align: center; font-weight: black; padding: 6px; margin-bottom: 15px; font-size: 16px; letter-spacing: 1px;">
          *** REPRINT CHIT (#${payload.reprintCount}) ***
          <div style="font-size: 10px; font-weight: normal; margin-top: 2px;">
            By: ${payload.reprintedBy || 'Staff'} at ${payload.reprintedAt ? new Date(payload.reprintedAt).toLocaleTimeString() : ''}
          </div>
        </div>
      `
      : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>KOT - ORDER #${payload.orderId}</title>
        <style>
          @media print {
            body { margin: 0; padding: 0; }
            @page { margin: 0; }
          }
          body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            margin: 10px;
            color: #000;
            background: #fff;
            width: 80mm;
            max-width: 80mm;
            line-height: 1.3;
          }
          .title {
            text-align: center;
            font-size: 20px;
            font-weight: 900;
            margin-bottom: 10px;
            letter-spacing: 2px;
            text-transform: uppercase;
            border-bottom: 3px double #000;
            padding-bottom: 8px;
          }
          .meta-info {
            font-size: 14px;
            margin-bottom: 12px;
            border-bottom: 2px dashed #000;
            padding-bottom: 8px;
          }
          .meta-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
          }
          .meta-label {
            font-weight: bold;
          }
          .meta-val {
            font-weight: bold;
          }
          .header-accent {
            font-size: 26px;
            font-weight: black;
            text-align: center;
            margin: 6px 0;
            color: #000;
          }
          .items-container {
            margin-top: 10px;
            min-height: 100px;
          }
          .notes-container {
            margin-top: 15px;
            border: 2px solid #000;
            padding: 8px;
            font-size: 14px;
          }
          .notes-label {
            font-weight: bold;
            margin-bottom: 4px;
            text-decoration: underline;
            text-transform: uppercase;
          }
        </style>
      </head>
      <body>
        ${reprintNotice}
        <div class="title">JOMORDER KOT</div>
        
        <div class="header-accent">ORDER #${payload.orderId}</div>
        
        <div class="meta-info">
          <div class="meta-row" style="font-size: 18px; margin-bottom: 8px;">
            <span class="meta-label">TABLE:</span>
            <span class="meta-val">${payload.tableName}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">TYPE:</span>
            <span class="meta-val" style="text-transform: uppercase;">${payload.orderType === 'dine_in' ? 'DINE IN' : 'TAKEAWAY'}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">DATE:</span>
            <span class="meta-val">${payload.date}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">TIME:</span>
            <span class="meta-val">${payload.time}</span>
          </div>
        </div>

        <div class="items-container">
          ${itemsRows}
        </div>

        ${payload.notes ? `
          <div class="notes-container">
            <div class="notes-label">KITCHEN SPECIAL NOTES:</div>
            <div style="word-wrap: break-word; font-weight: bold; font-size: 15px;">${payload.notes}</div>
          </div>
        ` : ''}

        <div style="text-align: center; margin-top: 25px; padding-top: 10px; border-top: 1px dashed #000; font-size: 10px;">
          --- End of Kitchen Ticket ---
        </div>
      </body>
      </html>
    `;
  }

  // --- HIDDEN IFRAME PRINT ACTION (AUTO PRINT POPUP) ---
  /**
   * Generates a hidden iframe, populates the thermal styled HTML code,
   * and triggers the browser printable workflow seamlessly in standard environments.
   */
  async printHtml(html: string): Promise<void> {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      
      document.body.appendChild(iframe);
      
      const doc = iframe.contentWindow?.document || iframe.contentDocument;
      if (!doc) throw new Error('Could not access print frame context');
      
      doc.open();
      doc.write(html);
      doc.close();

      // Simple delay to let content load before calling print dialog
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          console.warn('[PrinterService] Browser locked print inside frame, opening fallback:', e);
        } finally {
          // Remove iframe after sufficient print delay
          setTimeout(() => {
            document.body.removeChild(iframe);
          }, 60000);
        }
      }, 500);
    } catch (e) {
      console.error('[PrinterService] printHtml failed:', e);
    }
  }

  private triggerLocalBrowserPrints(restaurantId: string, jobs: PrintJob[]): void {
    const pendingBrowserJobs = jobs.filter(j => j.status === 'pending');
    pendingBrowserJobs.forEach(job => {
      this.triggerLocalBrowserPrint(restaurantId, job);
    });
  }

  private async triggerLocalBrowserPrint(restaurantId: string, job: PrintJob): Promise<void> {
    // Only invoke browser printed prompt if the target device config allows it (e.g. printer type is browser fallback)
    const printers = await this.getPrinters(restaurantId);
    const targetPrinter = printers.find(p => p.id === job.printerId);

    if (!targetPrinter || targetPrinter.type === 'browser') {
      console.log(`[PrinterService] Automatically invoking Print dialog for Job ${job.id}`);
      const ticketHtml = this.renderKOTHtml(job.payload);
      
      // Prompt user or execute
      await this.printHtml(ticketHtml);
      await this.markJobPrinted(restaurantId, job.id);
    }
  }
}

export const printerService = new PrinterService();
