import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";

import { supabaseAdmin } from "./src/server/services/dbService";
import { translateTextWithGemini } from "./src/server/services/translationService";
import apiRouter from "./src/server/routes";
import { handleStripeWebhook } from "./src/billing/webhooks/stripeWebhook";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());

// Stripe Webhook endpoint mounted BEFORE standard json parser to preserve raw payload signature
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(cookieParser());

// Simple logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Basic safety check for tenant settings
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (host.includes('double-tax')) {
    (req as any).doubleTaxSimulation = true;
  }
  next();
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Mount the aggregated routes under /api automatically or custom mounts inside apiRouter
app.use(apiRouter);

// Background translation job definition for food items
async function runBackgroundTranslationJob() {
  try {
    const { data: jobs, error: fetchErr } = await supabaseAdmin
      .from('translation_jobs')
      .select('id, restaurant_id, entity_type, entity_id, field_name, source_language, target_language')
      .eq('status', 'pending')
      .limit(5);

    if (fetchErr) {
      console.error('[Background Translation Job] Error fetching pending jobs:', fetchErr);
      return;
    }

    if (!jobs || jobs.length === 0) {
      return;
    }

    console.log(`[Background Translation Job] Found ${jobs.length} pending translation jobs to process.`);

    for (const job of jobs) {
      // Mark job as processing to avoid double processing
      await supabaseAdmin
        .from('translation_jobs')
        .update({ status: 'processing' })
        .eq('id', job.id);

      try {
        let textToTranslate = '';
        if (job.entity_type === 'menu_item') {
          const { data: item } = await supabaseAdmin
            .from('menu_items')
            .select('name, description')
            .eq('id', job.entity_id)
            .maybeSingle();

          if (item) {
            textToTranslate = job.field_name === 'description' ? item.description : item.name;
          }
        }

        if (!textToTranslate || !textToTranslate.trim()) {
          console.log(`[Background Translation Job] Empty text or item not found for job ${job.id}. Marking as completed.`);
          await supabaseAdmin
            .from('translation_jobs')
            .update({ 
              status: 'completed', 
              ai_generated_text: '', 
              reviewed_text: '', 
              review_status: 'approved'
            })
            .eq('id', job.id);
          continue;
        }

        console.log(`[Background Translation Job] Translating text for job ${job.id} to ${job.target_language}...`);
        const translated = await translateTextWithGemini(textToTranslate, job.target_language);

        if (translated) {
          // 1. Update the translation job
          await supabaseAdmin
            .from('translation_jobs')
            .update({
              status: 'completed',
              ai_generated_text: translated,
              reviewed_text: translated,
              review_status: 'draft'
            })
            .eq('id', job.id);

          // 2. Mirror/save immediately to tenant_translations so the restaurant has access to it
          await supabaseAdmin
            .from('tenant_translations')
            .upsert({
              restaurant_id: job.restaurant_id,
              entity_type: job.entity_type,
              entity_id: job.entity_id,
              field_name: job.field_name,
              language_code: job.target_language,
              translated_text: translated,
              translation_status: 'translated',
              override_global: true
            }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });

          // 3. Mirror/save to global_translations for fallback cache
          await supabaseAdmin
            .from('global_translations')
            .upsert({
              term_key: textToTranslate,
              language_code: job.target_language,
              translated_text: translated,
              confidence_score: 1.00,
              approved: true
            }, { onConflict: 'term_key,language_code' });

          console.log(`[Background Translation Job] Saved translations for "${textToTranslate.substring(0, 30)}" in ${job.target_language} -> "${translated.substring(0, 30)}"`);
        } else {
          throw new Error("Translation service returned empty result");
        }
      } catch (jobErr: any) {
        console.error(`[Background Translation Job] Failed processing job ${job.id}:`, jobErr);
        await supabaseAdmin
          .from('translation_jobs')
          .update({ status: 'failed' })
          .eq('id', job.id);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error('[Background Translation Job] Error in translation loop:', err);
  }
}

let translationJobStarted = false;
function startBackgroundTranslationJob() {
  if (translationJobStarted) return;
  translationJobStarted = true;

  console.log('[Background Translation Job] Initializing background translation runner...');
  setTimeout(() => {
    runBackgroundTranslationJob();
  }, 10000);

  setInterval(() => {
    runBackgroundTranslationJob();
  }, 45000);
}

async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
  }

  // Catch-all for API that didn't match any above
  app.all("/api/*", (req, res) => {
    console.warn(`[API 404 Catch-all] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ 
      error: `API endpoint not found: ${req.originalUrl}`,
      method: req.method,
      path: req.path
    });
  });

  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Ready at http://0.0.0.0:${PORT}`);
    console.log(`[SERVER] Env: ${process.env.NODE_ENV || 'development'}`);
    startBackgroundTranslationJob();
  });

  app.use((req, res) => {
    console.warn(`[FINAL 404] ${req.method} ${req.url}`);
    if (req.accepts('html')) {
       res.status(404).send('<html><body><h1>404 Not Found (My Custom Handler)</h1></body></html>');
    } else {
       res.status(404).json({ error: "Route not found", path: req.url });
    }
  });
}

// Global Error Handler (must be last)
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Global Error Handler:", err);
  if (res.headersSent) {
    return _next(err);
  }
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

start();
