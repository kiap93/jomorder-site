import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseAdminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const supabaseAdmin = createClient(supabaseUrl, supabaseAdminKey);

async function run() {
  console.log("Connecting to Supabase at:", supabaseUrl);
  try {
    // 1. Check restaurants table columns
    const { data: colsRes, error: colsErr } = await supabaseAdmin
      .from('restaurants')
      .select('*')
      .limit(1);
    
    if (colsErr) {
      console.error("Error reading restaurants:", colsErr);
    } else {
      console.log("Sample restaurant row:", colsRes);
    }

    // 2. Fetch all profiles to find active users
    const { data: users, error: userErr } = await supabaseAdmin
      .from('profiles')
      .select('*');
    
    if (userErr) {
      console.error("Error loading profiles:", userErr);
      return;
    }
    console.log(`Found ${users?.length || 0} profiles:`);
    console.log(users);

    // 3. For each user, fetch their workspace mappings
    for (const u of users || []) {
      console.log(`\nWorkspace details for profile: ${u.email} (${u.id})`);
      const { data: mappings, error: mapErr } = await supabaseAdmin
        .from('restaurant_users')
        .select('*, restaurants:restaurant_id(*)')
        .eq('user_id', u.id);

      if (mapErr) {
        console.error("Error on restaurant_users mapping:", mapErr);
      } else {
        console.log("restaurant_users rows:", mappings);
      }
    }
  } catch (err) {
    console.error("Exception during debug query:", err);
  }
}

run();
