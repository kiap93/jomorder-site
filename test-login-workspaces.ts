import dotenv from "dotenv";

dotenv.config();

const port = 3000;
const email = process.env.ADMIN_USER_EMAIL || "test@example.com";
const password = process.env.ADMIN_USER_PASSWORD || "password123";

async function run() {
  console.log("Simulating Login on Local Server on port:", port);
  try {
    const loginRes = await fetch(`http://localhost:${port}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!loginRes.ok) {
      console.error("Login failed with status:", loginRes.status, await loginRes.text());
      return;
    }

    const { token, user } = await loginRes.json();
    console.log("Login successful! User:", user);
    console.log("Token:", token.slice(0, 20) + "...");

    console.log("\nFetching workspaces...");
    const workspacesRes = await fetch(`http://localhost:${port}/api/my-workspaces`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!workspacesRes.ok) {
      console.error("Fetch workspaces failed with status:", workspacesRes.status, await workspacesRes.text());
      return;
    }

    const workspaces = await workspacesRes.json();
    console.log("Finished with success! Workspaces outcome:");
    console.log(JSON.stringify(workspaces, null, 2));
  } catch (err) {
    console.error("Exception during API test:", err);
  }
}

run();
