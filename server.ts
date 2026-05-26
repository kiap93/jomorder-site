import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";

import { supabaseAdmin } from "./src/server/services/dbService";
import { translateTextWithGemini } from "./src/server/services/translationService";
import apiRouter from "./src/server/routes";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
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
    const { data: items, error: fetchErr } = await supabaseAdmin
      .from('menu_items')
      .select('name, description');
    
    if (fetchErr || !items) {
      return;
    }

    const terms = new Set<string>();
    items.forEach(it => {
      if (it.name && it.name.trim()) terms.add(it.name.trim());
      if (it.description && it.description.trim()) terms.add(it.description.trim());
    });

    const termList = Array.from(terms);
    const targetLangs = ['zh', 'ms', 'th', 'ja', 'ko'];

    let translationCount = 0;
    const maxTranslationsPerRun = 5;

    for (const term of termList) {
      if (translationCount >= maxTranslationsPerRun) break;

      for (const lang of targetLangs) {
        if (translationCount >= maxTranslationsPerRun) break;

        const { data: existing, error: existingErr } = await supabaseAdmin
          .from('global_translations')
          .select('id')
          .eq('term_key', term)
          .eq('language_code', lang)
          .maybeSingle();

        if (existingErr) continue;

        if (!existing) {
          console.log(`[Background Translation Job] Translating "${term}" to ${lang}...`);
          const translated = await translateTextWithGemini(term, lang);
          if (translated) {
            const { error: insertErr } = await supabaseAdmin
              .from('global_translations')
              .upsert({
                term_key: term,
                language_code: lang,
                translated_text: translated,
                confidence_score: 1.00,
                approved: true
              }, { onConflict: 'term_key,language_code' });

            if (insertErr) {
              console.error(`[Background Translation Job] Failed to save translation for "${term}" in ${lang}:`, insertErr);
            } else {
              console.log(`[Background Translation Job] Saved global translation for "${term}" to ${lang}: "${translated}"`);
              translationCount++;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
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
