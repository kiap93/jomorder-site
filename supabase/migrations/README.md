# Supabase Migrations Directory

This directory follows the standard Supabase structure for database scheme management and production migration tracking.

## Local & Production Executions

Migrations are configured using monotonically increasing timestamp-ordered filenames. Applying schemas sequentially from earliest to latest ensures consistent setup, complete rollback safety, and exact logical tracking across development, staging, and production environments.

### Applied Migration Sequence:

1. **`20260515120000_base_supabase_schema.sql`**  
   Primal setup. Bootstraps base tables: `restaurants`, `categories`, `menu_items`, `tables`, `orders`, and standard `profiles`.

2. **`20260516120000_capabilities_schema.sql`**  
   Adds SaaS capability tracking models, subscription tiering (`saas_plans`), organization tables, settings, organization users, and restaurant user links.

3. **`20260517120000_multi_tenant_rbac.sql`**  
   Database-level Row Level Security (RLS) configurations, profile setup, and centralized `audit_logs` table for tracking operations.

4. **`20260518120000_organization_multitenant.sql`**  
   Defines organizations, organization users, and cross-references them to active restaurant IDs for robust enterprise multi-tenancy.

5. **`20260519120000_session_security_v1.sql`** & **`20260519130000_session_security_v2.sql`**  
   Secures guest dining sessions. Controls dynamic session creation, token validation, and limits data access boundaries.

6. **`20260520120000_basket_engine.sql`** & **`20260521120000_recovery_basket_engine.sql`**  
   Establishes client carts/baskets schemas enabling server-side caching of items for offline recovery.

7. **`20260522120000_payment_engine.sql`** & **`20260522130000_supabase_payments.sql`**  
   Installs payment ledgers, payment attempts, refunds, and initial webhook log structures.

8. **`20260523120000_recovery_order_engine.sql`** & **`20260523130000_sql_fix_0518.sql`**  
   Integrates database-level uniquely constrained `idempotency_key` columns for absolute replay protection and concurrent double-charge safety.

9. **`20260524120000_final_qr_engine.sql`**  
   Handles DuitNow / QR payment generation triggers, caching, and states.

10. **`20260525120000_supabase_cash_engine.sql`** & **`20260525130000_supabase_final_setup.sql`**  
    Implements cash drawers, split-payment options, settlement states, and final constraints consolidation.

11. **`20260526120000_supabase_kot_printing.sql`**  
    Defines printer profiles, conditional print jobs, routing, and Kitchen Order Ticket (KOT) sequences.

12. **`20260527120000_fix_rls_recursion.sql`** & **`20260527130000_fix_translation_rls.sql`**  
    Hardens multi-tenant RLS checks, eliminating recursion triggers in profile cross-checks.

13. **`20260528120000_disable_rls.sql`** & **`20260528130000_remove_spam_protection.sql`**  
    Bypasses rate-limiting bottlenecks for fast local development while maintaining precise middleware controls.

14. **`20260528140000_supabase_schema_branch.sql`**, **`20260528150000_final_schema_modifiers.sql`**, & **`20260528160000_refactor_schema_modifiers.sql`**  
    Supports modifiers, combo items, dynamic menu translations, and secondary branch indexing.

## Deployment Command
Apply all migrations upstream to your active Supabase project using the Supabase CLI:

```bash
supabase db push
```
