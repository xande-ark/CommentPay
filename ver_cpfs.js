require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error("ERRO: DB_ENCRYPTION_KEY inválida no .env. Deve ter 64 caracteres hexadecimais.");
  process.exit(1);
}

// Conexão com o Banco de Dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Função de Descriptografia do CPF
function decryptCPF(encryptedHex, ivHex, authTagHex) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    return "[Erro na descriptografia - Chave Incorreta?]";
  }
}

async function listUsers() {
  try {
    console.log("Conectando ao banco de dados...");
    const res = await pool.query("SELECT id, name, email, cpf_encrypted, cpf_iv, cpf_auth_tag, status FROM users ORDER BY name ASC");
    
    console.log("\n--- LISTA DE USUÁRIOS E CPFs ---");
    console.log("Total de usuários encontrados:", res.rows.length);
    console.log("---------------------------------\n");

    res.rows.forEach((user, index) => {
      let cpfReal = "NÃO CADASTRADO";
      if (user.cpf_encrypted && user.cpf_iv && user.cpf_auth_tag) {
        cpfReal = decryptCPF(user.cpf_encrypted, user.cpf_iv, user.cpf_auth_tag);
      }

      console.log(`[${index + 1}] Nome: ${user.name}`);
      console.log(`    Email: ${user.email}`);
      console.log(`    CPF:   ${cpfReal}`);
      console.log(`    Status: ${user.status}`);
      console.log("---------------------------------");
    });

  } catch (err) {
    console.error("Erro ao buscar usuários:", err);
  } finally {
    await pool.end();
  }
}

listUsers();
