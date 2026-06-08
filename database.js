const { Pool } = require('pg');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error("ERRO: DB_ENCRYPTION_KEY deve possuir 64 caracteres hexadecimais (32 bytes).");
  process.exit(1);
}

// Sal complementar para Hashing de CPF e IP
const SYSTEM_SALT = 'comentarios_reward_salt_2026';

// Conexão com o banco de dados PostgreSQL (Supabase/Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- UTILITÁRIOS CRIPTOGRÁFICOS ---

function hashSHA256(text) {
  return crypto.createHmac('sha256', SYSTEM_SALT).update(text).digest('hex');
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag
  };
}

function decrypt(encryptedHex, ivHex, authTagHex) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// --- ADAPTADOR DE QUERIES (DE SQLITE PARA POSTGRESQL) ---
// Substitui os '?' por '$1', '$2', etc., para manter compatibilidade com as rotas.
function adaptQuery(sql) {
  let counter = 1;
  return sql.replace(/\?/g, () => `$${counter++}`);
}

async function dbRun(sql, params = []) {
  if (sql === "BEGIN TRANSACTION") sql = "BEGIN";
  return pool.query(adaptQuery(sql), params);
}

async function dbGet(sql, params = []) {
  const result = await pool.query(adaptQuery(sql), params);
  return result.rows[0] || null;
}

async function dbAll(sql, params = []) {
  const result = await pool.query(adaptQuery(sql), params);
  return result.rows;
}

// --- INICIALIZAÇÃO DO BANCO POSTGRESQL ---

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.warn("AVISO: DATABASE_URL não definida! O banco não foi inicializado.");
    return;
  }

  // 1. Criação das Tabelas (Sintaxe PostgreSQL)
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      google_sub TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      cpf_hash TEXT UNIQUE NOT NULL,
      cpf_encrypted TEXT NOT NULL,
      cpf_iv TEXT NOT NULL,
      cpf_auth_tag TEXT NOT NULL,
      status TEXT DEFAULT 'pending_cpf',
      consent_accepted_at TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS peripheral_sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      blog_url TEXT,
      api_key_secret TEXT UNIQUE NOT NULL,
      reward_amount REAL DEFAULT 0.50,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_domain_blog_url UNIQUE (domain, blog_url)
    );

    CREATE TABLE IF NOT EXISTS comments_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      site_id TEXT NOT NULL REFERENCES peripheral_sites(id) ON DELETE RESTRICT,
      external_comment_id TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      ip_encrypted TEXT NOT NULL,
      ip_iv TEXT NOT NULL,
      ip_auth_tag TEXT NOT NULL,
      comment_text_hash TEXT NOT NULL,
      comment_text TEXT,
      status TEXT DEFAULT 'pending',
      fraud_score REAL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      validated_at TIMESTAMP
    );

    -- Índices Parciais Removidos para permitir o Bypass VIP do Admin
    DROP INDEX IF EXISTS idx_unique_user_site_active;
    DROP INDEX IF EXISTS idx_unique_ip_site_active;

    CREATE INDEX IF NOT EXISTS idx_comments_log_lookup 
    ON comments_log(site_id, external_comment_id);

    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      balance_available REAL DEFAULT 0.00,
      balance_pending REAL DEFAULT 0.00,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payout_transactions (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      gateway_tx_id TEXT,
      pix_key_type TEXT DEFAULT 'CPF',
      ip_encrypted TEXT,
      ip_iv TEXT,
      ip_auth_tag TEXT,
      error_message TEXT,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP
    );
  `;

  try {
    // Migrações no PostgreSQL para remover unicidade antiga de domain e criar nova de domain + blog_url
    try {
      await pool.query("ALTER TABLE peripheral_sites DROP CONSTRAINT IF EXISTS peripheral_sites_domain_key;");
    } catch (e) {
      console.log("[DB Migration] Drop domain constraint log:", e.message);
    }
    try {
      await pool.query("ALTER TABLE peripheral_sites ADD CONSTRAINT unique_domain_blog_url UNIQUE (domain, blog_url);");
    } catch (e) {
      console.log("[DB Migration] Add unique constraint log:", e.message);
    }

    await pool.query(schema);
    
    // Assegura as colunas na tabela existente (migration em tempo de execução)
    await pool.query(`
      ALTER TABLE payout_transactions 
      ADD COLUMN IF NOT EXISTS ip_encrypted TEXT,
      ADD COLUMN IF NOT EXISTS ip_iv TEXT,
      ADD COLUMN IF NOT EXISTS ip_auth_tag TEXT;
    `);

    console.log("[DB] Schema do PostgreSQL verificado com sucesso.");

    // Semeando os sites de teste
    const sitesToSeed = [
      {
        id: 'site-demo-id-123',
        name: 'Blog de Finanças do Alexandre',
        domain: 'localhost:3000',
        blog_url: '/demo-site/index.html',
        secret: 'api_secret_key_demo_456'
      },
      {
        id: 'site-lovepg-123',
        name: 'Love PG',
        domain: 'lovepg.com.br',
        blog_url: 'https://lovepg.com.br/blog/',
        secret: 'api_secret_key_lovepg_789'
      },
      {
        id: 'site-amorpg-123',
        name: 'Amor PG',
        domain: 'amorpg.com.br',
        blog_url: '/',
        secret: 'api_secret_key_amorpg_abc'
      },
      {
        id: 'site-095bet-apostas',
        name: '095 Bet - Apostas Esportivas',
        domain: '095bet.com.br',
        blog_url: '/apostas-esportivas/',
        secret: 'api_secret_key_095bet_apostas'
      },
      {
        id: 'site-939bet-home',
        name: '939 Bet',
        domain: '939bet.com.br',
        blog_url: '/',
        secret: 'api_secret_key_939bet_home'
      },
      {
        id: 'site-amorpg-e-confiavel',
        name: 'Amor PG - É Confiável',
        domain: 'amorpg.com.br',
        blog_url: '/e-confiavel/',
        secret: 'api_secret_key_amorpg_e_confiavel'
      },
      {
        id: 'site-bettigre-home',
        name: 'Bet Tigre',
        domain: 'bettigre.com.br',
        blog_url: '/',
        secret: 'api_secret_key_bettigre_home'
      },
      {
        id: 'site-brababet-home',
        name: 'Brababet',
        domain: 'brababet.com.br',
        blog_url: '/',
        secret: 'api_secret_key_brababet_home'
      },
      {
        id: 'site-brwin-home',
        name: 'Brwin',
        domain: 'brwin.com.br',
        blog_url: '/',
        secret: 'api_secret_key_brwin_home'
      },
      {
        id: 'site-brwin-e-confiavel',
        name: 'Brwin - É Confiável',
        domain: 'brwin.com.br',
        blog_url: '/e-confiavel/',
        secret: 'api_secret_key_brwin_e_confiavel'
      },
      {
        id: 'site-coroarbet-apostas',
        name: 'Coroarbet - Apostas Esportivas',
        domain: 'coroarbet.com.br',
        blog_url: '/apostas-esportivas/',
        secret: 'api_secret_key_coroarbet_apostas'
      },
      {
        id: 'site-dobrowin-cassino',
        name: 'Dobrowin - Cassino Online',
        domain: 'dobrowin.com.br',
        blog_url: '/cassino-online/',
        secret: 'api_secret_key_dobrowin_cassino'
      },
      {
        id: 'site-hot777-apostas',
        name: 'Hot777 - Apostas Esportivas',
        domain: 'hot777.com.br',
        blog_url: '/apostas-esportivas/',
        secret: 'api_secret_key_hot777_apostas'
      },
      {
        id: 'site-hubet-apostas',
        name: 'Hubet - Apostas Esportivas',
        domain: 'hubet.com.br',
        blog_url: '/apostas-esportivas/',
        secret: 'api_secret_key_hubet_apostas'
      },
      {
        id: 'site-kfbet-e-confiavel',
        name: 'Kfbet - É Confiável',
        domain: 'kfbet.com.br',
        blog_url: '/e-confiavel/',
        secret: 'api_secret_key_kfbet_e_confiavel'
      },
      {
        id: 'site-lazerpg-apostas',
        name: 'Lazerpg - Apostas Esportivas',
        domain: 'lazerpg.com.br',
        blog_url: '/apostas-esportivas/',
        secret: 'api_secret_key_lazerpg_apostas'
      },
      {
        id: 'site-r7bet-apostas',
        name: 'R7bet - Apostas Esportivas',
        domain: 'r7bet.com.br',
        blog_url: '/apostas-esportivas/',
        secret: 'api_secret_key_r7bet_apostas'
      },
      {
        id: 'site-svbet-apostas',
        name: 'Svbet - Apostas Esportivas',
        domain: 'svbet.com.br',
        blog_url: '/apostas-esportivas/',
        secret: 'api_secret_key_svbet_apostas'
      },
      {
        id: 'site-umcassino-apostas',
        name: 'Umcassino - Apostas Esportivas',
        domain: 'umcassino.com.br',
        blog_url: '/apostas-esportivas/',
        secret: 'api_secret_key_umcassino_apostas'
      },
      {
        id: 'site-wingdas-home',
        name: 'Wingdas',
        domain: 'wingdas.com.br',
        blog_url: '/',
        secret: 'api_secret_key_wingdas_home'
      },
      {
        id: 'site-wingdas-cassino',
        name: 'Wingdas - Cassino Online',
        domain: 'wingdas.com.br',
        blog_url: '/cassino-online/',
        secret: 'api_secret_key_wingdas_cassino'
      },
      {
        id: 'site-wingdas6-apostas',
        name: 'Wingdas6 - Apostas Esportivas',
        domain: 'wingdas6.com.br',
        blog_url: '/apostas-esportivas/',
        secret: 'api_secret_key_wingdas6_apostas'
      }
    ];

    for (const site of sitesToSeed) {
      const existing = await dbGet("SELECT id, domain, blog_url FROM peripheral_sites WHERE id = $1", [site.id]);
      if (!existing) {
        await dbRun(`
          INSERT INTO peripheral_sites (id, name, domain, blog_url, api_key_secret, reward_amount)
          VALUES ($1, $2, $3, $4, $5, 0.50)
        `, [site.id, site.name, site.domain, site.blog_url, site.secret]);
      } else if (existing.blog_url !== site.blog_url || existing.domain !== site.domain) {
        await dbRun(`
          UPDATE peripheral_sites 
          SET blog_url = $1, domain = $2 
          WHERE id = $3
        `, [site.blog_url, site.domain, site.id]);
      }
    }
  } catch (err) {
    console.error("[DB] Falha ao criar schema no PostgreSQL:", err);
    throw err;
  }
}

module.exports = {
  pool,
  initDb,
  hashSHA256,
  encrypt,
  decrypt,
  dbRun,
  dbGet,
  dbAll
};
