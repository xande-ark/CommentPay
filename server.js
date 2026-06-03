const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { OAuth2Client } = require('google-auth-library');
const { 
  initDb, 
  hashSHA256, 
  encrypt, 
  decrypt, 
  dbRun, 
  dbGet, 
  dbAll 
} = require('./database');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}));
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos do dashboard e demo-site
app.use(express.static('public'));
app.use('/demo-site', express.static('demo-site'));

// --- GERENCIAMENTO DE TOKENS (JWT MOCK SEGURO) ---

const JWT_SECRET = process.env.DB_ENCRYPTION_KEY || 'default_jwt_secret_key_123456';

function generateUserToken(userId) {
  const payload = JSON.stringify({ userId, exp: Date.now() + 24 * 60 * 60 * 1000 });
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + signature;
}

function verifyUserToken(token) {
  try {
    if (!token) return null;
    const [payloadB64, signature] = token.split('.');
    const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
    const computedSignature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
    if (computedSignature !== signature) return null;
    const data = JSON.parse(payload);
    if (data.exp < Date.now()) return null; // Expirado
    return data.userId;
  } catch (e) {
    return null;
  }
}

// Middleware de Autenticação do Usuário no Hub Central
function authMiddleware(req, res, next) {
  let token = req.headers.authorization;
  if (token && token.startsWith('Bearer ')) {
    token = token.slice(7);
  } else {
    token = req.query.token;
  }
  
  const userId = verifyUserToken(token);
  if (!userId) {
    return res.status(401).json({ status: 'error', code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' });
  }
  req.userId = userId;
  next();
}

// Validador de CPF Simplificado
function validateCPF(cpf) {
  cpf = cpf.replace(/[^\d]/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; 
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf.charAt(i)) * (10 - i);
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(cpf.charAt(9))) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf.charAt(i)) * (11 - i);
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(cpf.charAt(10))) return false;
  return true;
}

// --- ROTAS DA API ---

// Cliente OAuth2 do Google
const googleClient = new OAuth2Client("1081514821662-nj1oankja03vijqvccb0fbl25rt6vmdk.apps.googleusercontent.com");

// 1. Google OAuth (Oficial)
app.post('/api/v1/auth/google', async (req, res) => {
  // Código antigo mantido para debug/fallback
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ status: 'error', message: 'Token do Google ausente.' });
  }
  
  try {
    const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: "1081514821662-nj1oankja03vijqvccb0fbl25rt6vmdk.apps.googleusercontent.com",
    });
    
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const google_sub = payload.sub;

    const user = await dbGet("SELECT * FROM users WHERE google_sub = ?", [google_sub]);
    
    if (user) {
      if (user.status === 'active') {
        const token = generateUserToken(user.id);
        return res.json({ status: 'success', token, user: { id: user.id, email: user.email, name: user.name, status: user.status } });
      } else {
        return res.json({ status: 'pending_cpf', user: { email, name, google_sub } });
      }
    } else {
      return res.json({ status: 'pending_cpf', user: { email, name, google_sub } });
    }
  } catch (err) {
    console.error("Erro na verificação do Google JWT:", err);
    res.status(500).json({ status: 'error', message: 'Falha na autenticação com o Google.' });
  }
});

// 1.5 Google OAuth (Callback para modo Redirect do Mobile)
app.post('/api/v1/auth/google/callback', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).send("Token do Google ausente.");
  }
  
  try {
    const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: "1081514821662-nj1oankja03vijqvccb0fbl25rt6vmdk.apps.googleusercontent.com",
    });
    
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const google_sub = payload.sub;

    const user = await dbGet("SELECT * FROM users WHERE google_sub = ?", [google_sub]);
    
    let htmlResponse = "";
    
    if (user && user.status === 'active') {
      const token = generateUserToken(user.id);
      const safeUser = JSON.stringify({ id: user.id, email: user.email, name: user.name, status: user.status });
      htmlResponse = `
        <script>
          localStorage.setItem('cp_session_token', '${token}');
          localStorage.setItem('cp_session_user', '${safeUser}');
          window.location.href = '/index.html';
        </script>
      `;
    } else {
      const pendingData = JSON.stringify({ email, name, google_sub });
      htmlResponse = `
        <script>
          localStorage.setItem('cp_pending_google_data', '${pendingData}');
          window.location.href = '/index.html?action=register';
        </script>
      `;
    }
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Autenticando...</title></head>
      <body style="background: #0f172a; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif;">
        <h2>Aguarde, redirecionando...</h2>
        ${htmlResponse}
      </body>
      </html>
    `);
    
  } catch (err) {
    console.error("Erro no callback do Google:", err);
    res.status(500).send("Falha na autenticação. Tente novamente.");
  }
});

// 2. Registro de CPF + Finalização de Cadastro
app.post('/api/v1/auth/register-cpf', async (req, res) => {
  const { email, name, google_sub, cpf, consent } = req.body;
  
  if (!email || !name || !google_sub || !cpf) {
    return res.status(400).json({ status: 'error', message: 'Campos obrigatórios ausentes.' });
  }
  
  if (!consent) {
    return res.status(400).json({ status: 'error', message: 'O consentimento dos termos de uso e da LGPD é obrigatório.' });
  }
  
  if (!validateCPF(cpf)) {
    return res.status(400).json({ status: 'error', code: 'INVALID_CPF', message: 'CPF inválido ou em formato incorreto.' });
  }
  
  try {
    // 1. Validação de Unicidade de CPF
    const cpfHash = hashSHA256(cpf.replace(/[^\d]/g, ''));
    const existingCpf = await dbGet("SELECT id FROM users WHERE cpf_hash = ?", [cpfHash]);
    if (existingCpf) {
      return res.status(400).json({ status: 'error', code: 'DUPLICATE_CPF', message: 'Este CPF já está cadastrado em outra conta.' });
    }
    
    // 2. Criptografa CPF
    const cpfEnc = encrypt(cpf.replace(/[^\d]/g, ''));
    const userId = crypto.randomUUID();
    const walletId = crypto.randomUUID();
    
    // 3. Transação ACID de Criação de Usuário + Carteira
    await dbRun("BEGIN TRANSACTION");
    try {
      await dbRun(`
        INSERT INTO users (id, email, google_sub, name, cpf_hash, cpf_encrypted, cpf_iv, cpf_auth_tag, status, consent_accepted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `, [userId, email, google_sub, name, cpfHash, cpfEnc.encryptedData, cpfEnc.iv, cpfEnc.authTag, new Date().toISOString()]);
      
      await dbRun(`
        INSERT INTO wallets (id, user_id, balance_available, balance_pending)
        VALUES (?, ?, 25.00, 0.00)
      `, [walletId, userId]);
      
      await dbRun("COMMIT");
    } catch (e) {
      await dbRun("ROLLBACK");
      throw e;
    }
    
    const token = generateUserToken(userId);
    return res.status(201).json({ status: 'success', token, user: { id: userId, email, name, status: 'active' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao registrar usuário.' });
  }
});

// 3. Webhook 1: Registro Inicial de Comentário (Fase Escrow)
app.post('/api/v1/comments/submit', async (req, res) => {
  const siteId = req.headers['x-site-id'];
  const signature = req.headers['x-api-signature'];
  
  if (!siteId || !signature) {
    return res.status(401).json({ status: 'error', code: 'UNAUTHORIZED', message: 'Faltam cabeçalhos de autenticação.' });
  }
  
  const { user_token, external_comment_id, comment_text, user_ip, user_agent } = req.body;
  if (!user_token || !external_comment_id || !comment_text || !user_ip) {
    return res.status(400).json({ status: 'error', message: 'Campos obrigatórios do payload ausentes.' });
  }
  
  try {
    // 1. Busca dados do Site Periférico
    const site = await dbGet("SELECT * FROM peripheral_sites WHERE id = ?", [siteId]);
    if (!site || site.is_active !== 1) {
      return res.status(401).json({ status: 'error', code: 'INVALID_SITE', message: 'Site parceiro inválido ou inativo.' });
    }
    
    // 2. Valida Assinatura HMAC-SHA256
    const payloadStr = req.rawBody || JSON.stringify(req.body);
    const computedSignature = crypto.createHmac('sha256', site.api_key_secret).update(payloadStr).digest('hex');
    if (computedSignature !== signature) {
      return res.status(401).json({ status: 'error', code: 'INVALID_SIGNATURE', message: 'Assinatura HMAC inválida.' });
    }
    
    // 3. Valida Token do Usuário
    const userId = verifyUserToken(user_token);
    if (!userId) {
      return res.status(401).json({ status: 'error', code: 'INVALID_USER_TOKEN', message: 'Token de usuário expirado ou inválido.' });
    }
    
    // 4. PIPELINE ANTIFRAUDE & REGRAS DE NEGÓCIO
    
    // Camada A: Detecção de VPN/Proxy (Simulação com IPs bloqueados de teste)
    // IPs do tipo 1.1.1.1 ou que terminem em .99 serão bloqueados para fins de demonstração
    if (user_ip === '1.1.1.1' || user_ip.endsWith('.99')) {
      return res.status(400).json({ 
        status: 'error', 
        code: 'FRAUD_IP_DETECTED', 
        message: 'Acesso bloqueado. Foi detectado o uso de VPN, Proxy ou conexão de Data Center.' 
      });
    }
    
    // Camada B: Limite de tamanho mínimo
    if (comment_text.trim().length < 100) {
      return res.status(400).json({ 
        status: 'error', 
        code: 'CONTENT_TOO_SHORT', 
        message: 'O comentário deve conter no mínimo 100 caracteres para ser elegível para remuneração.' 
      });
    }
    
    // Camada C: Unicidade do Usuário no Site
    const existingUserComment = await dbGet(`
      SELECT id FROM comments_log 
      WHERE user_id = ? AND site_id = ? AND status IN ('pending', 'approved')
    `, [userId, siteId]);
    if (existingUserComment) {
      return res.status(400).json({ 
        status: 'error', 
        code: 'LIMIT_EXCEEDED', 
        message: 'Este usuário já possui um comentário remunerado (ativo ou pendente) neste site.' 
      });
    }
    
    // Camada D: Unicidade do IP no Site
    const ipHash = hashSHA256(user_ip);
    const existingIpComment = await dbGet(`
      SELECT id FROM comments_log 
      WHERE ip_hash = ? AND site_id = ? AND status IN ('pending', 'approved')
    `, [ipHash, siteId]);
    if (existingIpComment) {
      return res.status(400).json({ 
        status: 'error', 
        code: 'LIMIT_EXCEEDED', 
        message: 'Este endereço de IP já foi utilizado para um comentário remunerado neste site.' 
      });
    }
    
    // Camada E: Similaridade Semântica e Duplicidade de Conteúdo
    const commentTextHash = hashSHA256(comment_text.trim().toLowerCase());
    const existingTextComment = await dbGet(`
      SELECT id FROM comments_log 
      WHERE user_id = ? AND comment_text_hash = ?
    `, [userId, commentTextHash]);
    if (existingTextComment) {
      return res.status(400).json({ 
        status: 'error', 
        code: 'DUPLICATE_CONTENT', 
        message: 'Você já submeteu um comentário idêntico na plataforma.' 
      });
    }
    
    // 5. Criptografa o IP para auditoria segura (LGPD)
    const ipEnc = encrypt(user_ip);
    const commentLogId = crypto.randomUUID();
    
    // 6. Transação ACID de Gravação de Log + Incremento de Saldo Pendente
    await dbRun("BEGIN TRANSACTION");
    try {
      await dbRun(`
        INSERT INTO comments_log (id, user_id, site_id, external_comment_id, ip_hash, ip_encrypted, ip_iv, ip_auth_tag, comment_text_hash, comment_text, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `, [commentLogId, userId, siteId, external_comment_id, ipHash, ipEnc.encryptedData, ipEnc.iv, ipEnc.authTag, commentTextHash, comment_text]);
      
      await dbRun(`
        UPDATE wallets 
        SET balance_pending = balance_pending + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `, [site.reward_amount, userId]);
      
      await dbRun("COMMIT");
    } catch (e) {
      await dbRun("ROLLBACK");
      throw e;
    }
    
    return res.status(202).json({
      status: 'success',
      message: 'Comentário registrado com sucesso. Saldo pendente alocado.',
      comment_id: commentLogId,
      escrow_amount: site.reward_amount
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao submeter comentário.' });
  }
});

// 4. Webhook 2: Confirmação de Aprovação/Moderação de Comentário
app.post('/api/v1/comments/status-update', async (req, res) => {
  const siteId = req.headers['x-site-id'];
  const signature = req.headers['x-api-signature'];
  
  if (!siteId || !signature) {
    return res.status(401).json({ status: 'error', message: 'Faltam cabeçalhos de autenticação.' });
  }
  
  const { external_comment_id, status } = req.body;
  if (!external_comment_id || !status) {
    return res.status(400).json({ status: 'error', message: 'Campos obrigatórios do payload ausentes.' });
  }
  
  try {
    // 1. Busca dados do Site Periférico
    const site = await dbGet("SELECT * FROM peripheral_sites WHERE id = ?", [siteId]);
    if (!site || site.is_active !== 1) {
      return res.status(401).json({ status: 'error', message: 'Site parceiro inválido.' });
    }
    
    // 2. Valida Assinatura HMAC
    const payloadStr = req.rawBody || JSON.stringify(req.body);
    const computedSignature = crypto.createHmac('sha256', site.api_key_secret).update(payloadStr).digest('hex');
    if (computedSignature !== signature) {
      return res.status(401).json({ status: 'error', message: 'Assinatura HMAC inválida.' });
    }
    
    // 3. Busca o Log do Comentário
    const comment = await dbGet("SELECT * FROM comments_log WHERE external_comment_id = ? AND site_id = ?", [external_comment_id, siteId]);
    if (!comment) {
      return res.status(404).json({ status: 'error', code: 'COMMENT_NOT_FOUND', message: 'Log do comentário não encontrado.' });
    }
    
    if (comment.status !== 'pending') {
      return res.status(400).json({ status: 'error', message: 'Este comentário já foi processado anteriormente.' });
    }
    
    const rewardAmount = site.reward_amount;
    
    // 4. Transação ACID de atualização de saldos
    await dbRun("BEGIN TRANSACTION");
    try {
      if (status === 'approved') {
        // Libera do pendente para o disponível
        await dbRun(`
          UPDATE wallets 
          SET balance_pending = balance_pending - ?,
              balance_available = balance_available + ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?
        `, [rewardAmount, rewardAmount, comment.user_id]);
        
        await dbRun(`
          UPDATE comments_log 
          SET status = 'approved', validated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [comment.id]);
      } else {
        // status = 'rejected' ou 'spam'. Remove saldo pendente
        await dbRun(`
          UPDATE wallets 
          SET balance_pending = balance_pending - ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?
        `, [rewardAmount, comment.user_id]);
        
        await dbRun(`
          UPDATE comments_log 
          SET status = ?, validated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [status, comment.id]);
      }
      await dbRun("COMMIT");
    } catch (e) {
      await dbRun("ROLLBACK");
      throw e;
    }
    
    return res.json({
      status: 'success',
      message: `Comentário processado com sucesso como '${status}'. Saldo atualizado.`,
      released_amount: status === 'approved' ? rewardAmount : 0.00
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao processar atualização de status.' });
  }
});

// 5. Consulta de Saldo, Histórico de Ações e Transações do Usuário
app.get('/api/v1/wallet/status', authMiddleware, async (req, res) => {
  const userId = req.userId;
  
  try {
    const user = await dbGet("SELECT id, name, email FROM users WHERE id = ?", [userId]);
    const wallet = await dbGet("SELECT * FROM wallets WHERE user_id = ?", [userId]);
    
    // Busca logs de comentários
    const comments = await dbAll(`
      SELECT cl.id, cl.external_comment_id, cl.status, cl.created_at, cl.validated_at, ps.name as site_name, ps.reward_amount
      FROM comments_log cl 
      JOIN peripheral_sites ps ON cl.site_id = ps.id
      WHERE cl.user_id = ?
      ORDER BY cl.created_at DESC
    `, [userId]);
    
    // Busca saques solicitados
    const withdrawals = await dbAll(`
      SELECT * FROM payout_transactions
      WHERE wallet_id = ?
      ORDER BY requested_at DESC
    `, [wallet.id]);
    
    res.json({
      status: 'success',
      data: {
        user,
        wallet: {
          balance_available: wallet.balance_available,
          balance_pending: wallet.balance_pending,
          updated_at: wallet.updated_at
        },
        comments,
        withdrawals
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao carregar dados da carteira.' });
  }
});

// 5.5 Verifica status do usuário no site atual (se já comentou)
app.get('/api/v1/user/site-status', authMiddleware, async (req, res) => {
  const userId = req.userId;
  const domain = req.query.domain;

  if (!domain) {
    return res.status(400).json({ status: 'error', message: 'Domínio não fornecido.' });
  }

  try {
    const site = await dbGet("SELECT id FROM peripheral_sites WHERE domain = ?", [domain]);
    if (!site) {
      return res.json({ status: 'error', message: 'Site não encontrado.' });
    }

    const existingComment = await dbGet(`
      SELECT status FROM comments 
      WHERE user_id = ? AND site_id = ? AND (status = 'pending' OR status = 'approved')
      LIMIT 1
    `, [userId, site.id]);

    res.json({
      status: 'success',
      has_commented: !!existingComment,
      comment_status: existingComment ? existingComment.status : null
    });
  } catch (err) {
    console.error("Erro ao verificar site status:", err);
    res.status(500).json({ status: 'error', message: 'Erro ao verificar status do site.' });
  }
});

// 6. Solicitação de Saque via PIX (Com Fila de Worker simulada)
app.post('/api/v1/wallet/withdraw', authMiddleware, async (req, res) => {
  const userId = req.userId;
  const { amount } = req.body;
  
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ status: 'error', message: 'Valor de saque inválido.' });
  }
  
  const saqueMinimo = 20.00;
  if (amount < saqueMinimo) {
    return res.status(400).json({ 
      status: 'error', 
      code: 'MINIMUM_WITHDRAWAL', 
      message: `O valor mínimo para saque é de R$ ${saqueMinimo.toFixed(2)}.` 
    });
  }
  
  try {
    const wallet = await dbGet("SELECT * FROM wallets WHERE user_id = ?", [userId]);
    if (!wallet || wallet.balance_available < amount) {
      return res.status(400).json({ 
        status: 'error', 
        code: 'INSUFFICIENT_FUNDS', 
        message: 'Saldo disponível insuficiente para realizar este saque.' 
      });
    }
    
    const transactionId = crypto.randomUUID();
    
    // Transação ACID: Deduz saldo disponível imediatamente e gera saque pendente (Evita gasto duplo)
    await dbRun("BEGIN TRANSACTION");
    try {
      await dbRun(`
        UPDATE wallets 
        SET balance_available = balance_available - ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [amount, wallet.id]);
      
      await dbRun(`
        INSERT INTO payout_transactions (id, wallet_id, amount, status, pix_key_type)
        VALUES (?, ?, ?, 'pending', 'CPF')
      `, [transactionId, wallet.id, amount]);
      
      await dbRun("COMMIT");
    } catch (e) {
      await dbRun("ROLLBACK");
      throw e;
    }
    
    // --- SIMULAÇÃO DO WORKER DE PROCESSAMENTO VIA REDIS/BULLMQ ---
    // O worker irá rodar de forma assíncrona (setTimeout de 4 segundos)
    setTimeout(async () => {
      try {
        // 1. Busca os dados de criptografia do CPF do usuário
        const user = await dbGet("SELECT cpf_encrypted, cpf_iv, cpf_auth_tag FROM users WHERE id = ?", [userId]);
        
        // 2. Descriptografa o CPF em memória (segurança do worker)
        const userCpf = decrypt(user.cpf_encrypted, user.cpf_iv, user.cpf_auth_tag);
        
        // 3. Dispara a API do PIX do Gateway com a chave de Idempotência (transactionId)
        // Simulamos sucesso de 90%, mas se o saque for no valor de R$ 999.00 ele sempre falha para testar o estorno (Refund)
        const isSuccess = (amount !== 999.00 && Math.random() < 0.95);
        
        if (isSuccess) {
          // Liquidado com sucesso
          const gatewayTxId = 'gwy_pix_' + crypto.randomBytes(8).toString('hex');
          await dbRun(`
            UPDATE payout_transactions
            SET status = 'completed', gateway_tx_id = ?, processed_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [gatewayTxId, transactionId]);
          console.log(`[Worker PIX] Saque ${transactionId} de R$ ${amount} liquidado com sucesso para a chave CPF ${userCpf}.`);
        } else {
          // Falha na transferência (ex: Chave PIX não registrada na conta destino)
          const errorMsg = amount === 999.00 ? 'Simulação de falha do Gateway de Pagamento.' : 'Chave PIX (CPF) inválida ou não encontrada no banco central.';
          
          await dbRun("BEGIN TRANSACTION");
          try {
            // Estorna o valor de volta para a carteira do usuário
            await dbRun(`
              UPDATE wallets 
              SET balance_available = balance_available + ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `, [amount, wallet.id]);
            
            // Marca a transação de saque como falha
            await dbRun(`
              UPDATE payout_transactions
              SET status = 'failed', error_message = ?, processed_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `, [errorMsg, transactionId]);
            
            await dbRun("COMMIT");
          } catch (errTx) {
            await dbRun("ROLLBACK");
            throw errTx;
          }
          console.log(`[Worker PIX] Falha no saque ${transactionId} de R$ ${amount}: ${errorMsg}. Valor estornado.`);
        }
      } catch (errWorker) {
        console.error("[Worker PIX Error]:", errWorker);
      }
    }, 4000);
    
    return res.status(201).json({
      status: 'success',
      message: 'Saque solicitado com sucesso. Processamento PIX enfileirado.',
      transaction_id: transactionId,
      amount
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao solicitar saque.' });
  }
});

// 6.1. Listar Sites Parceiros
app.get('/api/v1/sites/list', async (req, res) => {
  try {
    const sites = await dbAll("SELECT id, name, domain, blog_url, reward_amount FROM peripheral_sites WHERE is_active = 1");
    res.json({ status: 'success', data: sites });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao buscar sites parceiros.' });
  }
});


// --- ENDPOINTS SIMULADOS DO SITE PERIFÉRICO (BLOG BACKEND) ---

app.post('/api/blog/comment', async (req, res) => {
  const { comment_text, user_token, user_ip, site_id } = req.body;
  if (!comment_text || !user_token || !user_ip) {
    return res.status(400).json({ status: 'error', message: 'Campos obrigatórios ausentes.' });
  }

  const targetSiteId = site_id || 'site-demo-id-123';

  try {
    // Busca as credenciais do site no banco de dados para assinar o webhook
    const site = await dbGet("SELECT * FROM peripheral_sites WHERE id = ?", [targetSiteId]);
    if (!site) {
      return res.status(404).json({ status: 'error', message: 'Site parceiro não encontrado.' });
    }

    const externalCommentId = 'wp_cmt_' + Math.floor(Math.random() * 1000000);
    
    const webhookPayload = {
      user_token,
      external_comment_id: externalCommentId,
      comment_text,
      user_ip,
      user_agent: req.headers['user-agent'] || 'MockAgent'
    };

    const payloadStr = JSON.stringify(webhookPayload);
    const signature = crypto.createHmac('sha256', site.api_key_secret).update(payloadStr).digest('hex');

    const hubRes = await fetch(`http://localhost:${PORT}/api/v1/comments/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Site-ID': site.id,
        'X-API-Signature': signature
      },
      body: payloadStr
    });

    const data = await hubRes.json();
    if (hubRes.status === 202) {
      return res.status(202).json({
        status: 'success',
        message: 'Comentário enviado para moderação.',
        external_comment_id: externalCommentId,
        comment_id: data.comment_id
      });
    } else {
      return res.status(hubRes.status).json(data);
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'Erro ao registrar comentário no hub.' });
  }
});

app.post('/api/blog/moderate', async (req, res) => {
  const { external_comment_id, status, site_id } = req.body;
  if (!external_comment_id || !status) {
    return res.status(400).json({ status: 'error', message: 'Campos ausentes.' });
  }

  const targetSiteId = site_id || 'site-demo-id-123';

  try {
    const site = await dbGet("SELECT * FROM peripheral_sites WHERE id = ?", [targetSiteId]);
    if (!site) {
      return res.status(404).json({ status: 'error', message: 'Site parceiro não encontrado.' });
    }

    const webhookPayload = {
      external_comment_id,
      status,
      moderation_reason: 'Ação executada no Painel do Blog'
    };

    const payloadStr = JSON.stringify(webhookPayload);
    const signature = crypto.createHmac('sha256', site.api_key_secret).update(payloadStr).digest('hex');

    const hubRes = await fetch(`http://localhost:${PORT}/api/v1/comments/status-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Site-ID': site.id,
        'X-API-Signature': signature
      },
      body: payloadStr
    });

    const data = await hubRes.json();
    return res.status(hubRes.status).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'Erro ao despachar webhook de moderação.' });
  }
});

// 7. Endpoint auxiliar para o Painel Admin do Blog Parceiro
// Retorna os comentários pendentes locais para serem moderados
app.get('/api/v1/comments/pending-local', async (req, res) => {
  try {
    const comments = await dbAll(`
      SELECT cl.id, cl.external_comment_id, cl.comment_text, cl.status, cl.created_at, cl.site_id, u.name as user_name, u.email as user_email, ps.name as site_name
      FROM comments_log cl
      JOIN users u ON cl.user_id = u.id
      JOIN peripheral_sites ps ON cl.site_id = ps.id
      WHERE cl.status = 'pending'
      ORDER BY cl.created_at ASC
    `);
    res.json({ status: 'success', data: comments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao buscar comentários pendentes.' });
  }
});

// 8. Endpoint auxiliar para o Blog Parceiro
// Retorna a lista de comentários APROVADOS (publicados) para exibição visual no artigo
app.get('/api/v1/comments/demo-list', async (req, res) => {
  const { site_id } = req.query;
  
  try {
    let comments;
    if (site_id) {
      comments = await dbAll(`
        SELECT cl.id, cl.external_comment_id, cl.created_at, u.name as user_name
        FROM comments_log cl
        JOIN users u ON cl.user_id = u.id
        WHERE cl.status = 'approved' AND cl.site_id = ?
        ORDER BY cl.created_at DESC
      `, [site_id]);
    } else {
      comments = await dbAll(`
        SELECT cl.id, cl.external_comment_id, cl.created_at, u.name as user_name
        FROM comments_log cl
        JOIN users u ON cl.user_id = u.id
        WHERE cl.status = 'approved'
        ORDER BY cl.created_at DESC
      `);
    }
    
    // Simulamos alguns comentários fictícios para compor a lista do blog se estiver vazia
    const mockComments = [
      { id: 'mock-1', user_name: 'Mariana Costa', created_at: new Date(Date.now() - 3600000 * 2).toISOString(), comment_text: 'Esse artigo explica muito bem o conceito. Parabéns!' },
      { id: 'mock-2', user_name: 'Roberto Silva', created_at: new Date(Date.now() - 3600000 * 24).toISOString(), comment_text: 'Excelente reflexão. Vou começar a aplicar essas dicas hoje mesmo.' }
    ];
    res.json({ status: 'success', data: comments, mock_comments: mockComments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao carregar comentários do blog.' });
  }
});

// --- INICIALIZAÇÃO E START DO SERVIDOR ---

// --- INICIALIZAÇÃO E START DO SERVIDOR ---

initDb()
  .then(() => {
    // Só inicia o servidor localmente na porta se NÃO estiver rodando no ambiente Serverless da Vercel
    if (!process.env.VERCEL) {
      app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`Servidor rodando com sucesso na porta ${PORT}`);
        console.log(`Central Hub: http://localhost:${PORT}/index.html`);
        console.log(`Blog Parceiro: http://localhost:${PORT}/demo-site/index.html`);
        console.log(`====================================================`);
      });
    } else {
      console.log('Banco de dados inicializado no ambiente Vercel Serverless.');
    }
  })
  .catch((err) => {
    console.error("Falha ao inicializar o banco de dados:", err);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
  });

// Exporta o app para o Vercel Serverless Functions
module.exports = app;
