require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://default:A6gZ5hItNcbp@ep-red-bush-a4a06o0r.us-east-1.aws.neon.tech:5432/verceldb?sslmode=require' });

pool.query("SELECT id, email, google_sub, status FROM users WHERE email = 'webdesigner77rf@gmail.com'", (err, res) => {
  console.log(err || res.rows);
  process.exit();
});
