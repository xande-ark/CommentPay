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

app.get('/api/debug-hmac', (req, res) => {
  res.json({
    hmacError: global.lastHmacError || { message: 'No HMAC error yet' },
    webhookError: global.lastWebhookError || { message: 'No Webhook error yet' }
  });
});
app.use('/demo-site', express.static('demo-site'));

// --- GERENCIAMENTO DE TOKENS (JWT MOCK SEGURO) ---

const JWT_SECRET = process.env.DB_ENCRYPTION_KEY;
if (!JWT_SECRET || JWT_SECRET.length === 0) {
  console.error("ERRO CRÍTICO: A variável de ambiente DB_ENCRYPTION_KEY é obrigatória para assinar e validar tokens.");
  process.exit(1);
}

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
    
    const sigBuffer = Buffer.from(signature, 'hex');
    const computedBuffer = Buffer.from(computedSignature, 'hex');
    if (sigBuffer.length !== computedBuffer.length || !crypto.timingSafeEqual(sigBuffer, computedBuffer)) {
      return null;
    }
    
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

// Middleware de Autenticação do Admin
function adminAuthMiddleware(req, res, next) {
  let token = req.headers.authorization;
  if (token && token.startsWith('Bearer ')) {
    token = token.slice(7);
  }
  
  const adminId = verifyUserToken(token);
  if (adminId !== 'admin_root') {
    return res.status(401).json({ status: 'error', message: 'Acesso Administrativo Negado.' });
  }
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

// Escapa strings para uso seguro dentro de blocos de script inline delimitados por plicas (XSS)
function escapeForSingleQuotes(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/<\/script>/ig, '<\\/script>')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// --- ROTAS DA API ---

// 0. Autenticação Admin
app.post('/api/v1/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const adminToken = generateUserToken('admin_root');
    return res.json({ status: 'success', token: adminToken });
  }
  return res.status(401).json({ status: 'error', message: 'Credenciais inválidas.' });
});

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
      const escapedToken = escapeForSingleQuotes(token);
      const escapedSafeUser = escapeForSingleQuotes(safeUser);
      htmlResponse = `
        <script>
          localStorage.setItem('cp_session_token', '${escapedToken}');
          localStorage.setItem('cp_session_user', '${escapedSafeUser}');
          window.location.href = '/index.html';
        </script>
      `;
    } else {
      const pendingData = JSON.stringify({ email, name, google_sub });
      const escapedPendingData = escapeForSingleQuotes(pendingData);
      htmlResponse = `
        <script>
          localStorage.setItem('cp_pending_google_data', '${escapedPendingData}');
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
        VALUES (?, ?, 0.00, 0.00)
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
    res.status(500).json({ status: 'error', message: 'Erro ao registrar usuário: ' + err.message });
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
    
    // 2. Valida Assinatura HMAC-SHA256 (Robust validation using concatenated fields)
    const signaturePayload = `${user_token}|${external_comment_id}|${user_ip}`;
    const computedSignature = crypto.createHmac('sha256', site.api_key_secret).update(signaturePayload).digest('hex');
    
    const sigBuf = Buffer.from(signature, 'hex');
    const compBuf = Buffer.from(computedSignature, 'hex');
    if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
      global.lastHmacError = {
        time: new Date(),
        siteId: site.id,
        receivedSig: signature,
        computedSig: computedSignature,
        signaturePayload,
        rawBody: req.rawBody,
        secret: site.api_key_secret
      };
      console.error(`[HMAC ERROR] Site: ${site.id}`);
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
    if (comment_text.trim().length < 50) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'O comentário deve conter no mínimo 50 caracteres para ser elegível para remuneração.' 
      });
    }
    
    // Verifica se é o admin (Alexandre) para liberar comentários infinitos
    const userRow = await dbGet("SELECT name FROM users WHERE id = ?", [userId]);
    const isVip = userRow && userRow.name && userRow.name.toLowerCase().includes('alexandre');

    // Camada C: Unicidade do Usuário no Site (Ignorado para VIP)
    if (!isVip) {
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
    }
    
    // Camada D: Unicidade do IP no Site (Ignorado para VIP)
    const ipHash = hashSHA256(user_ip);
    if (!isVip) {
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
    const signaturePayload = `${external_comment_id}|${status}`;
    const computedSignature = crypto.createHmac('sha256', site.api_key_secret).update(signaturePayload).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const compBuf = Buffer.from(computedSignature, 'hex');
    if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
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
      SELECT cl.id, cl.site_id, cl.external_comment_id, cl.status, cl.created_at, cl.validated_at, ps.name as site_name, ps.reward_amount
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
  const path = req.query.path || '/';

  if (!domain) {
    return res.status(400).json({ status: 'error', message: 'Domínio não fornecido.' });
  }

  try {
    // Normalizar caminhos para checagem exata (com ou sem barra final)
    const stdPath = path.endsWith('/') ? path : `${path}/`;
    const altPath = path.endsWith('/') ? path.slice(0, -1) : path;

    let site = await dbGet(
      "SELECT id FROM peripheral_sites WHERE domain = ? AND (blog_url = ? OR blog_url = ?)", 
      [domain, stdPath, altPath]
    );

    // Se não encontrou o caminho específico, tenta o fallback para a Página Principal do domínio (onde blog_url é '/' ou vazio ou null)
    if (!site) {
      site = await dbGet(
        "SELECT id FROM peripheral_sites WHERE domain = ? AND (blog_url = '/' OR blog_url = '' OR blog_url IS NULL)",
        [domain]
      );
    }

    if (!site) {
      return res.json({ status: 'error', message: 'Site não encontrado.' });
    }

    const existingComment = await dbGet(`
      SELECT status FROM comments_log 
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
    
    // Captura e criptografa IP
    let userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    if (userIp.includes(',')) userIp = userIp.split(',')[0].trim();
    if (userIp === '::1') userIp = '127.0.0.1';
    
    const ipEnc = encrypt(userIp);
    
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
        INSERT INTO payout_transactions (id, wallet_id, amount, status, pix_key_type, ip_encrypted, ip_iv, ip_auth_tag)
        VALUES (?, ?, ?, 'pending', 'CPF', ?, ?, ?)
      `, [transactionId, wallet.id, amount, ipEnc.encryptedData, ipEnc.iv, ipEnc.authTag]);
      
      await dbRun("COMMIT");
    } catch (e) {
      await dbRun("ROLLBACK");
      throw e;
    }
    
    // O worker automático foi removido. Os saques ficarão com status 'pending' até o admin aprovar manualmente.
    
    return res.status(201).json({
      status: 'success',
      message: 'Saque em processamento. O pagamento será efetuado em até 24 horas úteis (pagamentos não ocorrem em finais de semana).',
      transaction_id: transactionId,
      amount
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao solicitar saque.' });
  }
});

// 6.1. Listar Sites Parceiros (Ordenados por domínio/caminho)
app.get('/api/v1/sites/list', async (req, res) => {
  try {
    const sites = await dbAll("SELECT id, name, domain, blog_url, reward_amount FROM peripheral_sites WHERE is_active = 1 ORDER BY domain ASC, blog_url ASC");
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

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers.host;
    const baseUrl = process.env.VERCEL ? `https://${host}` : `http://localhost:${PORT}`;

    const hubRes = await fetch(`${baseUrl}/api/v1/comments/submit`, {
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

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers.host;
    const baseUrl = process.env.VERCEL ? `https://${host}` : `http://localhost:${PORT}`;

    const hubRes = await fetch(`${baseUrl}/api/v1/comments/status-update`, {
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

// ==========================================
// ROTAS DO PAINEL ADMIN SEGURO
// ==========================================

// 1. Listar Comentários Pendentes (Admin)
app.get('/api/v1/admin/comments/pending', adminAuthMiddleware, async (req, res) => {
  try {
    const rawComments = await dbAll(`
      SELECT cl.id, cl.external_comment_id, cl.comment_text, cl.status, cl.created_at, cl.site_id, 
             cl.ip_encrypted, cl.ip_iv, cl.ip_auth_tag,
             u.name as user_name, u.email as user_email, ps.name as site_name
      FROM comments_log cl
      JOIN users u ON cl.user_id = u.id
      JOIN peripheral_sites ps ON cl.site_id = ps.id
      WHERE cl.status = 'pending'
      ORDER BY cl.created_at ASC
    `);
    
    const comments = rawComments.map(c => {
      let user_ip = 'Desconhecido';
      if (c.ip_encrypted && c.ip_iv && c.ip_auth_tag) {
        try { user_ip = decrypt(c.ip_encrypted, c.ip_iv, c.ip_auth_tag); } catch (e) {}
      }
      delete c.ip_encrypted; delete c.ip_iv; delete c.ip_auth_tag;
      return { ...c, user_ip };
    });
    
    res.json({ status: 'success', data: comments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao buscar comentários pendentes.' });
  }
});

// 2. Moderar Comentários (Admin)
app.post('/api/v1/admin/comments/moderate', adminAuthMiddleware, async (req, res) => {
  const { external_comment_id, status, site_id } = req.body;
  if (!external_comment_id || !status || !site_id) return res.status(400).json({ status: 'error', message: 'Campos ausentes.' });

  try {
    const site = await dbGet("SELECT * FROM peripheral_sites WHERE id = ?", [site_id]);
    if (!site) return res.status(404).json({ status: 'error', message: 'Site parceiro não encontrado.' });
    
    const comment = await dbGet("SELECT * FROM comments_log WHERE external_comment_id = ? AND site_id = ?", [external_comment_id, site_id]);
    if (!comment || comment.status !== 'pending') return res.status(400).json({ status: 'error', message: 'Comentário não encontrado ou já processado.' });
    
    const rewardAmount = site.reward_amount;
    
    await dbRun("BEGIN TRANSACTION");
    try {
      if (status === 'approved') {
        await dbRun(`UPDATE wallets SET balance_pending = balance_pending - ?, balance_available = balance_available + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`, [rewardAmount, rewardAmount, comment.user_id]);
        await dbRun(`UPDATE comments_log SET status = 'approved', validated_at = CURRENT_TIMESTAMP WHERE id = ?`, [comment.id]);
      } else {
        await dbRun(`UPDATE wallets SET balance_pending = balance_pending - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`, [rewardAmount, comment.user_id]);
        await dbRun(`UPDATE comments_log SET status = ?, validated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, comment.id]);
      }
      await dbRun("COMMIT");
      
      // Sincroniza o status de volta para o WordPress (Webhook 3)
      if (site.domain) {
        const payloadStr = `${external_comment_id}|${status}`;
        const signature = crypto.createHmac('sha256', site.api_key_secret).update(payloadStr).digest('hex');
        const baseUrl = site.domain.startsWith('http') ? site.domain : `https://${site.domain}`;
        const webhookUrl = `${baseUrl}/wp-json/commentpay/v1/sync-status`;
        
        try {
          const proxyUrl = process.env.CF_WORKER_PROXY_URL;
          let fetchUrl = webhookUrl;
          const headers = {
            'Content-Type': 'application/json',
            'X-API-Signature': signature,
            'x-cf-bypass': process.env.CF_BYPASS_TOKEN || 'LagguBypass#5202*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          };

          if (proxyUrl) {
            fetchUrl = proxyUrl;
            headers['X-Target-Url'] = webhookUrl;
          }

          const wpRes = await fetch(fetchUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              external_comment_id: String(external_comment_id),
              status: status
            })
          });
          const wpText = await wpRes.text();
          if (!wpRes.ok) {
            console.error(`[WP SYNC ERROR] HTTP ${wpRes.status}:`, wpText);
            global.lastWebhookError = { status: wpRes.status, body: wpText, url: webhookUrl };
          } else {
             global.lastWebhookError = { status: wpRes.status, body: wpText, success: true };
          }
        } catch (err) {
          console.error(`[WP SYNC] Network failure no site ${site.id}:`, err);
          global.lastWebhookError = { error: err.message, url: webhookUrl };
        }
      }
      
    } catch (e) { await dbRun("ROLLBACK"); throw e; }
    
    return res.json({ status: 'success', message: `Comentário processado como '${status}'.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'Erro ao moderar comentário.' });
  }
});

// 2.5 Listar todos os sites parceiros com segredos de API (Admin)
app.get('/api/v1/admin/sites', adminAuthMiddleware, async (req, res) => {
  try {
    const sites = await dbAll("SELECT * FROM peripheral_sites ORDER BY domain ASC, blog_url ASC");
    res.json({ status: 'success', data: sites });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao buscar sites parceiros.' });
  }
});

// 3. Listar Saques Pendentes (Admin)
app.get('/api/v1/admin/withdrawals/pending', adminAuthMiddleware, async (req, res) => {
  try {
    const rawWithdrawals = await dbAll(`
      SELECT pt.id, pt.amount, pt.requested_at, pt.pix_key_type,
             pt.ip_encrypted, pt.ip_iv, pt.ip_auth_tag,
             u.id as user_id, u.name as user_name, u.email as user_email, u.cpf_encrypted, u.cpf_iv, u.cpf_auth_tag
      FROM payout_transactions pt
      JOIN wallets w ON pt.wallet_id = w.id
      JOIN users u ON w.user_id = u.id
      WHERE pt.status = 'pending'
      ORDER BY pt.requested_at ASC
    `);
    
    const withdrawals = rawWithdrawals.map(w => {
      let ip = 'Desconhecido';
      let cpf = 'Desconhecido';
      try {
        if (w.ip_encrypted && w.ip_iv && w.ip_auth_tag) ip = decrypt(w.ip_encrypted, w.ip_iv, w.ip_auth_tag);
        if (w.cpf_encrypted && w.cpf_iv && w.cpf_auth_tag) cpf = decrypt(w.cpf_encrypted, w.cpf_iv, w.cpf_auth_tag);
      } catch (e) {}
      delete w.ip_encrypted; delete w.ip_iv; delete w.ip_auth_tag;
      delete w.cpf_encrypted; delete w.cpf_iv; delete w.cpf_auth_tag;
      return { ...w, user_ip: ip, user_cpf: cpf };
    });
    
    // Varredura de Segurança (Anti-Fraude): Verifica se este IP já foi usado por mais de 1 usuário (Multi-accounting)
    for (let w of withdrawals) {
      w.is_suspicious_ip = false;
      if (w.user_ip !== 'Desconhecido') {
        const ipHash = hashSHA256(w.user_ip);
        // Conta quantos usuários diferentes usaram esse IP para comentar (comments_log já possui ip_hash)
        const countRes = await dbGet("SELECT COUNT(DISTINCT user_id) as c FROM comments_log WHERE ip_hash = ?", [ipHash]);
        
        // Verifica também nas próprias transações em memória (caso ambos não tenham comentado ainda, mas tentaram sacar)
        const usersWithThisIpInPending = new Set(withdrawals.filter(x => x.user_ip === w.user_ip).map(x => x.user_id));
        
        if ((countRes && countRes.c > 1) || usersWithThisIpInPending.size > 1) {
          w.is_suspicious_ip = true;
        }
      }
    }

    
    res.json({ status: 'success', data: withdrawals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao buscar saques pendentes.' });
  }
});

// 4. Moderar Saques (Admin)
app.post('/api/v1/admin/withdrawals/moderate', adminAuthMiddleware, async (req, res) => {
  const { transaction_id, status } = req.body;
  if (!transaction_id || !status) return res.status(400).json({ status: 'error', message: 'Campos ausentes.' });

  try {
    const tx = await dbGet("SELECT * FROM payout_transactions WHERE id = ?", [transaction_id]);
    if (!tx || tx.status !== 'pending') return res.status(404).json({ status: 'error', message: 'Transação não encontrada ou já processada.' });

    await dbRun("BEGIN TRANSACTION");
    try {
      if (status === 'completed') {
        const gatewayTxId = 'admin_' + crypto.randomBytes(4).toString('hex');
        await dbRun(`UPDATE payout_transactions SET status = 'completed', gateway_tx_id = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`, [gatewayTxId, transaction_id]);
      } else if (status === 'rejected') {
        await dbRun(`UPDATE wallets SET balance_available = balance_available + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [tx.amount, tx.wallet_id]);
        await dbRun(`UPDATE payout_transactions SET status = 'failed', error_message = 'Rejeitado pelo Administrador', processed_at = CURRENT_TIMESTAMP WHERE id = ?`, [transaction_id]);
      }
      await dbRun("COMMIT");
    } catch (e) { await dbRun("ROLLBACK"); throw e; }

    res.json({ status: 'success', message: `Saque processado como ${status}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Erro ao processar saque.' });
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
