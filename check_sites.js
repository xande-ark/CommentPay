const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkDb() {
  try {
    const res = await pool.query("SELECT * FROM peripheral_sites");
    console.log("SITES:", res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
checkDb();
