// --- ESTADO GLOBAL DA APLICAÇÃO ---
let sessionToken = localStorage.getItem('cp_session_token') || null;
let sessionUser = JSON.parse(localStorage.getItem('cp_session_user')) || null;
let tempGoogleData = null; // Para guardar temporariamente dados do Google antes do CPF
let pollingInterval = null;

// --- DOM ELEMENTS ---
const authView = document.getElementById('auth-view');
const registerView = document.getElementById('register-view');
const dashboardView = document.getElementById('dashboard-view');

// Tab Navigation Elements
const navDashboard = document.getElementById('nav-dashboard');
const navSites = document.getElementById('nav-sites');
const tabDashboardContent = document.getElementById('tab-dashboard-content');
const tabSitesContent = document.getElementById('tab-sites-content');
const sitesSearchInput = document.getElementById('sites-search-input');
const sitesListGrid = document.getElementById('sites-list-grid');
const linkViewAllSites = document.getElementById('link-view-all-sites');
const btnGoToSites = document.getElementById('btn-go-to-sites');


const googleEmailInput = document.getElementById('google-email');
const googleNameInput = document.getElementById('google-name');
const btnGoogleLogin = document.getElementById('btn-google-login');

const regCpfInput = document.getElementById('reg-cpf');
const regConsentCheckbox = document.getElementById('reg-consent');
const btnRegisterSubmit = document.getElementById('btn-register-submit');
const registerError = document.getElementById('register-error');
const registerErrorMsg = document.getElementById('register-error-msg');

const userDisplayName = document.getElementById('user-display-name');
const btnLogout = document.getElementById('btn-logout');
const btnRefresh = document.getElementById('btn-refresh');

const valAvailable = document.getElementById('val-available');
const valPending = document.getElementById('val-pending');
const withdrawAmountInput = document.getElementById('withdraw-amount');
const btnWithdraw = document.getElementById('btn-withdraw');
const withdrawStatus = document.getElementById('withdraw-status');

const commentsTableBody = document.getElementById('comments-table-body');
const withdrawalsTableBody = document.getElementById('withdrawals-table-body');

// --- FORMATADOR DE CPF (MÁSCARA DINÂMICA) ---
regCpfInput.addEventListener('input', (e) => {
  let value = e.target.value.replace(/\D/g, '');
  if (value.length > 11) value = value.slice(0, 11);
  
  if (value.length > 9) {
    value = value.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
  } else if (value.length > 6) {
    value = value.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
  } else if (value.length > 3) {
    value = value.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
  }
  e.target.value = value;
});

// --- INICIALIZAÇÃO ---
function init() {
  if (sessionToken && sessionUser) {
    showDashboard();
  } else {
    showAuth();
  }
}

// --- CONTROLE DE TELAS ---
function showAuth() {
  authView.classList.remove('hidden');
  registerView.classList.add('hidden');
  dashboardView.classList.add('hidden');
  clearInterval(pollingInterval);
}

function showRegister() {
  authView.classList.add('hidden');
  registerView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
}

function showDashboard() {
  // Se for um popup de SSO, avisa o site pai e fecha
  if (window.opener) {
    try {
      window.opener.postMessage({
        type: 'SSO_SUCCESS',
        token: sessionToken,
        user: sessionUser
      }, '*');
      window.close();
      return;
    } catch (e) {
      console.error("Erro ao comunicar SSO para o site pai:", e);
    }
  }

  authView.classList.add('hidden');
  registerView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  
  userDisplayName.textContent = sessionUser.name;
  fetchWalletData();
  
  // Inicia um polling leve para atualizar saldos (a cada 6 segundos)
  clearInterval(pollingInterval);
  pollingInterval = setInterval(fetchWalletData, 6000);
}

// --- FLUXO DE LOGIN (GOOGLE OFICIAL) ---
window.handleCredentialResponse = async (response) => {
  try {
    const res = await fetch('/api/v1/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    
    const data = await res.json();
    
    if (data.status === 'success') {
      // Usuário já cadastrado com CPF. Login direto!
      localStorage.setItem('cp_session_token', data.token);
      localStorage.setItem('cp_session_user', JSON.stringify(data.user));
      sessionToken = data.token;
      sessionUser = data.user;
      showDashboard();
    } else if (data.status === 'pending_cpf') {
      // Usuário novo ou sem CPF. Exige preenchimento cadastral
      tempGoogleData = data.user;
      showRegister();
    }
  } catch (err) {
    console.error(err);
    alert("Erro na comunicação com a API.");
  }
});

// --- FLUXO DE REGISTRO DE CPF ---
btnRegisterSubmit.addEventListener('click', async () => {
  const cpf = regCpfInput.value.trim();
  const consent = regConsentCheckbox.checked;
  
  registerError.classList.add('hidden');
  
  if (!cpf) {
    showRegError("Por favor, digite seu CPF.");
    return;
  }
  
  if (!consent) {
    showRegError("Você precisa aceitar os Termos e Consentimento LGPD.");
    return;
  }
  
  try {
    const payload = {
      ...tempGoogleData,
      cpf,
      consent
    };
    
    const res = await fetch('/api/v1/auth/register-cpf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    
    if (res.status === 201 && data.status === 'success') {
      localStorage.setItem('cp_session_token', data.token);
      localStorage.setItem('cp_session_user', JSON.stringify(data.user));
      sessionToken = data.token;
      sessionUser = data.user;
      showDashboard();
    } else {
      showRegError(data.message || "Erro desconhecido ao validar CPF.");
    }
  } catch (err) {
    console.error(err);
    showRegError("Erro ao registrar no banco de dados.");
  }
});

function showRegError(msg) {
  registerErrorMsg.textContent = msg;
  registerError.classList.remove('hidden');
}

// --- BUSCA DADOS DO DASHBOARD ---
async function fetchWalletData() {
  if (!sessionToken) return;
  
  try {
    const res = await fetch('/api/v1/wallet/status', {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (res.status === 401) {
      logout();
      return;
    }
    
    const body = await res.json();
    if (body.status === 'success') {
      const { wallet, comments, withdrawals } = body.data;
      
      // Atualiza Saldos na Tela
      valAvailable.textContent = `R$ ${wallet.balance_available.toFixed(2).replace('.', ',')}`;
      valPending.textContent = `R$ ${wallet.balance_pending.toFixed(2).replace('.', ',')}`;
      
      // Habilita saque se tiver saldo disponível suficiente (>= 20)
      if (wallet.balance_available >= 20.00) {
        btnWithdraw.disabled = false;
        withdrawAmountInput.disabled = false;
        withdrawAmountInput.max = wallet.balance_available;
      } else {
        btnWithdraw.disabled = true;
        withdrawAmountInput.disabled = true;
      }
      
      renderComments(comments);
      renderWithdrawals(withdrawals);
    }
  } catch (err) {
    console.error("Erro ao sincronizar saldos:", err);
  }
}

// --- DESENHA LOGS DE COMENTÁRIOS ---
function renderComments(comments) {
  if (comments.length === 0) {
    commentsTableBody.innerHTML = `<tr><td colspan="5" class="table-placeholder">Nenhum comentário registrado ainda.</td></tr>`;
    return;
  }
  
  commentsTableBody.innerHTML = comments.map(c => {
    let badgeClass = 'pending';
    let badgeLabel = 'Pendente';
    
    if (c.status === 'approved') {
      badgeClass = 'approved';
      badgeLabel = 'Aprovado';
    } else if (c.status === 'rejected') {
      badgeClass = 'rejected';
      badgeLabel = 'Rejeitado';
    } else if (c.status === 'spam') {
      badgeClass = 'spam';
      badgeLabel = 'Spam';
    }
    
    const formattedDate = new Date(c.created_at).toLocaleString('pt-BR');
    
    return `
      <tr>
        <td><strong>${escapeHTML(c.site_name)}</strong></td>
        <td><code>${escapeHTML(c.external_comment_id)}</code></td>
        <td>R$ ${c.reward_amount.toFixed(2).replace('.', ',')}</td>
        <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
        <td>${formattedDate}</td>
      </tr>
    `;
  }).join('');
}

// --- DESENHA LOGS DE TRANSACÕES DE SAQUE ---
function renderWithdrawals(withdrawals) {
  if (withdrawals.length === 0) {
    withdrawalsTableBody.innerHTML = `<tr><td colspan="4" class="table-placeholder">Nenhuma transação de saque solicitada.</td></tr>`;
    return;
  }
  
  withdrawalsTableBody.innerHTML = withdrawals.map(w => {
    let badgeClass = 'pending';
    let badgeLabel = 'Fila (PIX)';
    
    if (w.status === 'completed') {
      badgeClass = 'completed';
      badgeLabel = 'Pago (PIX)';
    } else if (w.status === 'failed') {
      badgeClass = 'failed';
      badgeLabel = 'Falhou';
    } else if (w.status === 'processing') {
      badgeClass = 'processing';
      badgeLabel = 'Enviando';
    }
    
    const formattedDate = new Date(w.requested_at).toLocaleString('pt-BR');
    const gatewayTx = w.gateway_tx_id ? `<code>${w.gateway_tx_id}</code>` : `<span class="text-muted" title="${w.error_message || 'Aguardando processamento'}">-</span>`;
    
    return `
      <tr>
        <td><strong>R$ ${w.amount.toFixed(2).replace('.', ',')}</strong></td>
        <td><span class="badge ${badgeClass}" title="${w.error_message || ''}">${badgeLabel}</span></td>
        <td>${gatewayTx}</td>
        <td>${formattedDate}</td>
      </tr>
    `;
  }).join('');
}

// --- SOLICITAÇÃO DE SAQUE ---
btnWithdraw.addEventListener('click', async () => {
  const amount = parseFloat(withdrawAmountInput.value);
  
  if (isNaN(amount) || amount < 20) {
    alert("O saque mínimo é de R$ 20,00.");
    return;
  }
  
  btnWithdraw.disabled = true;
  withdrawStatus.classList.add('hidden');
  
  try {
    const res = await fetch('/api/v1/wallet/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({ amount })
    });
    
    const data = await res.json();
    
    if (res.status === 201 && data.status === 'success') {
      withdrawStatus.className = "alert success";
      withdrawStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> Solicitação criada! PIX será enviado em alguns segundos.`;
      withdrawStatus.classList.remove('hidden');
      withdrawAmountInput.value = '';
      
      // Atualiza a tela imediatamente
      await fetchWalletData();
      
      // Executa polling rápido a cada 1.5s por 4 vezes para mostrar a transição da fila do PIX
      let pollCount = 0;
      const quickPoll = setInterval(async () => {
        pollCount++;
        await fetchWalletData();
        if (pollCount >= 4) clearInterval(quickPoll);
      }, 1500);
      
    } else {
      withdrawStatus.className = "alert error";
      withdrawStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${data.message}`;
      withdrawStatus.classList.remove('hidden');
      btnWithdraw.disabled = false;
    }
  } catch (err) {
    console.error(err);
    alert("Falha ao comunicar requisição de saque.");
    btnWithdraw.disabled = false;
  }
});

// --- REFRESH E LOGOUT ---
btnRefresh.addEventListener('click', () => {
  btnRefresh.firstElementChild.classList.add('fa-spin');
  fetchWalletData().finally(() => {
    setTimeout(() => {
      btnRefresh.firstElementChild.classList.remove('fa-spin');
    }, 500);
  });
});

btnLogout.addEventListener('click', logout);

function logout() {
  localStorage.removeItem('cp_session_token');
  localStorage.removeItem('cp_session_user');
  sessionToken = null;
  sessionUser = null;
  showAuth();
}

// --- CONTROLE DE ABAS (SPA TABS) ---
let cachedSites = [];

function switchTab(target) {
  if (target === 'dashboard') {
    navDashboard.classList.add('active');
    navSites.classList.remove('active');
    tabDashboardContent.classList.remove('hidden');
    tabSitesContent.classList.add('hidden');
  } else if (target === 'sites') {
    navDashboard.classList.remove('active');
    navSites.classList.add('active');
    tabDashboardContent.classList.add('hidden');
    tabSitesContent.classList.remove('hidden');
    fetchSitesList();
  }
}

navDashboard.addEventListener('click', (e) => {
  e.preventDefault();
  switchTab('dashboard');
});

navSites.addEventListener('click', (e) => {
  e.preventDefault();
  switchTab('sites');
});

if (linkViewAllSites) {
  linkViewAllSites.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('sites');
  });
}

if (btnGoToSites) {
  btnGoToSites.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('sites');
  });
}

// --- BUSCA DE SITES PARCEIROS DA API ---
async function fetchSitesList() {
  try {
    const res = await fetch('/api/v1/sites/list');
    const body = await res.json();
    if (body.status === 'success') {
      cachedSites = body.data;
      renderSitesList(cachedSites);
    }
  } catch (err) {
    console.error("Erro ao carregar sites parceiros:", err);
  }
}

function renderSitesList(sites) {
  if (sites.length === 0) {
    sitesListGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; margin-bottom: 12px; display: block; opacity: 0.5;"></i>
        Nenhum site parceiro encontrado para esta pesquisa.
      </div>
    `;
    return;
  }

  sitesListGrid.innerHTML = sites.map(s => {
    // Se tiver blog_url definida no banco usa ela, senão monta a url base do domínio
    let targetUrl = s.blog_url || (s.domain.startsWith('http') ? s.domain : `https://${s.domain}`);
    if (targetUrl) {
      const separator = targetUrl.includes('?') ? '&' : '?';
      targetUrl += separator + 'cp=1';
    }
    const isDemo = s.id === 'site-demo-id-123';
    const badgeColor = isDemo ? 'var(--purple)' : 'var(--green-text)';
    const badgeText = isDemo ? 'Ambiente de Teste' : 'Remuneração Ativa';
    const iconClass = isDemo ? 'fa-graduation-cap text-cyan' : 'fa-gamepad text-purple';

    return `
      <div class="site-card-item">
        <div class="site-card-logo">
          <i class="fa-solid ${iconClass}"></i>
        </div>
        <div class="site-card-details">
          <h4>${escapeHTML(s.name)}</h4>
          <span class="site-card-domain">${escapeHTML(s.domain)}</span>
          <span class="blog-badge" style="color: ${badgeColor};">
            <i class="fa-solid ${isDemo ? 'fa-microchip' : 'fa-check-double'}"></i> ${badgeText}
          </span>
          <div class="site-card-footer">
            <span class="site-card-reward">R$ ${s.reward_amount.toFixed(2).replace('.', ',')}</span>
            <a href="${targetUrl}" target="_blank" class="btn btn-primary btn-sm-card" style="${isDemo ? 'background: linear-gradient(135deg, var(--cyan), #0891b2); box-shadow: 0 4px 15px rgba(6, 182, 212, 0.4);' : ''}">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> Acessar Blogs
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Filtro de Busca
if (sitesSearchInput) {
  sitesSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const filtered = cachedSites.filter(s => 
      s.name.toLowerCase().includes(query) || 
      s.domain.toLowerCase().includes(query)
    );
    renderSitesList(filtered);
  });
}


// --- SECURITY UTILS ---
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- BOOTSTRAP ---
init();
