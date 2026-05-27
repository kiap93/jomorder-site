# ENTERPRISE SaaS SECURITY ARCHITECTURE
## Multi-Tenant RBAC & Zero-Trust Backend Design
**Author**: Senior SaaS Security Architect  
**Project**: AI-Powered Multi-Tenant Restaurant Ordering System & POS  
**Focus**: Multi-Tenant Isolation, Capability-Based Access Control, and Zero-Hardcoded Auditing Paths

---

## 1. Complete RBAC Redesign

An enterprise-ready restaurant POS must transition from simple role matching (`user.role === 'admin'`) to **Capability-Based Authorization** (e.g. `menu:write`, `payments:refund`). Roles are treated merely as *groupings of default capabilities*. At runtime, capabilities are resolved by checking both role defaults and **Custom Permissions overlays** mapped globally or by restaurant user associations.

### Core Architecture Roles
1. **Super Admin (SaaS HQ)**: Root access, views billing history, acts on global tenant registrations, manages general service packages, resolves edge instances. Zero tenant-specific capabilities are hardcoded to them; they are granted automated virtual capability sets globally.
2. **Tenant Owner / Admin**: Has root capabilities within their isolated tenant space. Can add/remove employees, toggle modules, view high-level revenue analytics, and override pricing.
3. **Store Manager**: Handles general operation settings, modifies active menu items, views sales reports, authorizes non-trivial orders, and issues standard voids in POS.
4. **Cashier / Service Desk**: Writes orders, receives table checkout signals, records raw cash transitions, issues minor order cancellations prior to kitchen preparation.
5. **Kitchen Display System (KDS)**: Special purpose station identity. Read-only menu context, write-only order state transitions (`pending` -> `cooking` -> `ready`).
6. **Guest / Customer**: Unauthenticated or session-bound guest reader of public menus and creator of `pending` order payloads. Restricted strictly from mutations.

---

## 2. Granular Permission Matrix

The following matrix represents the capabilities mapping for default roles, overlays, and system entities:

| Capability Name | System Key | Cashier | Kitchen | Manager | Owner | Super Admin | Guest Access |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **View Menu** | `menu:read` | Yes | Yes | Yes | Yes | Yes | Yes (Public) |
| **Edit Menu & Prices** | `menu:write` | No | No | Yes | Yes | Yes | No |
| **Create New Orders** | `order:write` | Yes | No | Yes | Yes | Yes | Yes (Pending Only) |
| **Read Order Queues** | `order:read` | Yes | Yes | Yes | Yes | Yes | No |
| **Status Transitions** | `order:advance`| Yes | Yes | Yes | Yes | Yes | No |
| **Cancel Active Order** | `order:cancel` | Yes | No | Yes | Yes | Yes | Yes (Before prep) |
| **Authorize Refund** | `payments:refund`| No | No | Yes | Yes | Yes | No |
| **View Employee Staff** | `staff:read` | No | No | Yes | Yes | Yes | No |
| **Manage Employee Accounts**| `staff:manage`| No | No | No | Yes | Yes | No |
| **View Store Analytics** | `analytics:read`| No | No | Yes | Yes | Yes | No |
| **Manage SaaS Tenancy** | `tenant:write`| No | No | No | No | Yes | No |

---

## 3. Capability Naming Strategy

Our capability namespace uses a standard **`resource:action`** pattern to guarantee horizontal scaling.

* **Prefix (`resource`)**: The bounded domain domain (e.g. `menu`, `order`, `staff`, `payments`, `analytics`, `tenant`).
* **Suffix (`action`)**: The specific CRUD context of operations (e.g. `read`, `write`, `cancel`, `refund`, `manage`).

This prevents permission creep because the developer does not guess authorization levels. Instead of matching against standard roles, backend endpoints evaluate granular capabilities:
```typescript
// Example capability checking guard
app.put('/api/restaurants/:restId/menu', requireCapability('menu:write'), handler);
```

---

## 4. JWT Claims Payload Design

We prevent high latency database roundtrips for raw authentication by packaging vital claims inside a cryptographic **JWT (JSON Web Token)**. However, to mitigate stale claims (e.g., if a manager is suspended mid-shift), our capability middleware runs a lightweight cache lookup against the database.

### Detailed JWT Payload Schema
```json
{
  "iss": "jomorder-saas-auth",
  "sub": "user_01H8XST5GPY8N2JZ73A9Z56T1W",
  "iat": 1693004800,
  "exp": 1693091200,
  "id": "user_01H8XST5GPY8N2JZ73A9Z56T1W",
  "email": "manager@klbistro.com",
  "role": "manager",
  "restaurantId": "a5cfb3e0-c2c2-400a-9b01-b684a3a428a7",
  "status": "active",
  "capabilities": [
    "menu:read",
    "menu:write",
    "order:read",
    "order:write",
    "order:advance",
    "order:cancel",
    "payments:refund",
    "staff:read",
    "analytics:read"
  ],
  "isSuperAdmin": false
}
```

---

## 5. Multi-Tenant Isolation Strategy

Cross-tenant data pollution ("leakage") is the absolute highest priority vulnerability in any SaaS application. We enforce multi-tenant isolation at three concentric rings:

```
+-------------------------------------------------------------+
| Ring 1: API Router Filter (Token Match Guard)               |
| Checks that user.restaurantId == URL:restId                 |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Ring 2: ORM Engine (Implicit WHERE Injections)              |
| DB service client queries are strictly bound to restId      |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Ring 3: Database Database RLS (Row-Level Security)        |
| Strict Postgres policies enforcing restaurant_id validation  |
+-------------------------------------------------------------+
```

### Applied RLS Example Rule (Supabase Postgres)
```sql
CREATE POLICY tenant_isolation_policy ON orders
  FOR ALL
  USING (restaurant_id = auth.jwt() ->> 'restaurantId');
```

---

## 6. Audit Log Strategy

Any operational update matching state authorization changes (employee updates, payment cancellations, price hikes) triggers a structured, asynchronous audit event.

### Audit Log Schema (`audit_logs` table)
| Column Name | Type | Purpose |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Unique event locator. Default `gen_random_uuid()` |
| `timestamp` | `TIMESTAMPTZ` | Microsecond precision of actual occurrence |
| `restaurant_id`| `UUID` (Foreign Key) | Isolated Tenant boundaries context |
| `user_id` | `UUID` (Nullable) | Triggers actor. Null represents guest/automated webhook action |
| `user_email` | `VARCHAR` | Human readable actor accountability tracking |
| `user_role` | `VARCHAR` | Actor's authorization role during action |
| `action` | `TEXT` | Human readable action description (e.g., "Refund issued for order ord-3921") |
| `metadata` | `JSONB` | Deep context logs (Client IP Address, old transaction amount, state diffs) |

---

## 7. Security Vulnerability Assessment & Recommendations

### Evaluated Vulnerabilities in Current Framework
1. **Hardcoded Admin Access Pattern**: Previously, routes bypassed all filters if `user.email === 'admin@saas.com'`. This is a risk because email takeover instantly breaches administrative dashboards.
   * *Status*: **RESOLVED** via capability-based checks and multi-factor-ready authentication middlewares.
2. **Postgres RLS Recurrences**: Multiple recursive policies lookup `profiles` from within `profiles` RLS, resulting in stack depth overflows.
   * *Recommendation*: Prefer session-derived JWT custom claims or highly optimized, non-recursive helper security triggers.
3. **Firestore Unrestricted Reads**: Traditional setups allowed wildcard document reads on parent paths.
   * *Status*: **RESOLVED** by overwriting `/firestore.rules` to enforce exact isolated `isTenantMember(restaurantId)` lookups on table collections.
4. **JWT Stale State Actions**: If employees are fired or suspended, their issued JWT continues to act as an access permit for up to its expiry time (e.g. 24 hours).
   * *Recommendation*: Query the local tenant registration cache on critical modifications (`payments:refund`, `staff:manage`) to check active employee status, as implemented inside our newly written capability verification middleware.
