let sessionToken = localStorage.getItem('cp_session_token') || null;
let sessionUser = JSON.parse(localStorage.getItem('cp_session_user')) || null;
let tempGoogleData = null; // Para guardar temporariamente dados do Google antes do CPF
let pollingInterval = null;
let userCommentsCache = []; // Cache global de comentários do usuário
let userWithdrawalsCache = [];
let showAllComments = false;
let showAllWithdrawals = false;

// --- DOM ELEMENTS ---
const authView = document.getElementById('auth-view');
const registerView = document.getElementById('register-view');
const dashboardView = document.getElementById('dashboard-wrapper');

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

// Callback oficial do Google Identity Services (Modo Popup)
window.handleGoogleLogin = async function(response) {
  try {
    const res = await fetch('/api/v1/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    
    const data = await res.json();
    if (data.status === 'success') {
      localStorage.setItem('cp_session_token', data.token);
      localStorage.setItem('cp_session_user', JSON.stringify(data.user));
      sessionToken = data.token;
      sessionUser = data.user;
      showDashboard();
    } else if (data.status === 'pending_cpf') {
      tempGoogleData = data.user;
      showRegister();
    } else {
      alert("Erro no login: " + (data.message || "Tente novamente."));
    }
  } catch (err) {
    console.error(err);
    alert("Erro de comunicação com o servidor ao fazer login com Google.");
  }
};

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

// Gamification Progress Elements
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');
const progressBarFill = document.getElementById('progress-bar-fill');

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
  // Update tokens if they were just set by redirect script
  sessionToken = localStorage.getItem('cp_session_token') || null;
  sessionUser = JSON.parse(localStorage.getItem('cp_session_user')) || null;

  const urlParams = new URLSearchParams(window.location.search);
  
  if (urlParams.get('action') === 'register') {
    const pendingData = localStorage.getItem('cp_pending_google_data');
    if (pendingData) {
      tempGoogleData = JSON.parse(pendingData);
      localStorage.removeItem('cp_pending_google_data');
      // Limpa a URL para não ficar suja
      window.history.replaceState({}, document.title, window.location.pathname);
      showRegister();
      return;
    }
  }

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
      
      // Armazena no cache global e renderiza
      userCommentsCache = comments;
      userWithdrawalsCache = withdrawals;
      
      // Atualiza a lista de sites se a aba de sites estiver ativa (para desativar botões)
      if (navSites.classList.contains('active') && cachedSites.length > 0) {
        updateSitesList();
      }
      
      // Lógica de Gamificação / Barra de Progresso
      const goal = 20.00;
      const current = wallet.balance_available;
      let percent = (current / goal) * 100;
      if (percent > 100) percent = 100;
      
      // Anima a barra e os textos
      progressBarFill.style.width = `${percent}%`;
      progressPercent.textContent = `${Math.floor(percent)}%`;
      
      if (current >= goal) {
        progressText.textContent = "Parabéns! Saque liberado.";
        progressText.style.color = "var(--green)";
        btnWithdraw.disabled = false;
        withdrawAmountInput.disabled = false;
        withdrawAmountInput.max = current;
      } else {
        const missing = (goal - current).toFixed(2).replace('.', ',');
        progressText.textContent = `Faltam R$ ${missing} para liberar o resgate`;
        progressText.style.color = "var(--text-secondary)";
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
  
  const limit = 1;
  const itemsToRender = showAllComments ? comments : comments.slice(0, limit);
  
  let html = itemsToRender.map(c => {
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
        <td data-label="Site"><strong>${escapeHTML(c.site_name)}</strong></td>
        <td data-label="ID"><code>${escapeHTML(c.external_comment_id)}</code></td>
        <td data-label="Valor">R$ ${c.reward_amount.toFixed(2).replace('.', ',')}</td>
        <td data-label="Status"><span class="badge ${badgeClass}">${badgeLabel}</span></td>
        <td data-label="Data">${formattedDate}</td>
      </tr>
    `;
  }).join('');
  
  if (!showAllComments && comments.length > limit) {
    html += `
      <tr>
        <td colspan="5" style="text-align: center; padding: 12px; background: transparent; border-bottom: none;">
          <button class="btn" style="font-size: 0.8rem; padding: 6px 16px; border-radius: 20px; background: #e2e8f0; color: #475569; font-weight: 600; cursor: pointer; border: none;" onclick="toggleComments()">
            Ver todos os ${comments.length} registros <i class="fa-solid fa-chevron-down"></i>
          </button>
        </td>
      </tr>
    `;
  } else if (showAllComments && comments.length > limit) {
    html += `
      <tr>
        <td colspan="5" style="text-align: center; padding: 12px; background: transparent; border-bottom: none;">
          <button class="btn" style="font-size: 0.8rem; padding: 6px 16px; border-radius: 20px; background: #e2e8f0; color: #475569; font-weight: 600; cursor: pointer; border: none;" onclick="toggleComments()">
            Ver menos <i class="fa-solid fa-chevron-up"></i>
          </button>
        </td>
      </tr>
    `;
  }
  
  commentsTableBody.innerHTML = html;
}

window.toggleComments = function() {
  showAllComments = !showAllComments;
  renderComments(userCommentsCache);
};

// --- DESENHA LOGS DE TRANSACÕES DE SAQUE ---
function renderWithdrawals(withdrawals) {
  if (withdrawals.length === 0) {
    withdrawalsTableBody.innerHTML = `<tr><td colspan="4" class="table-placeholder">Nenhuma transação de saque solicitada.</td></tr>`;
    return;
  }
  
  const limit = 1;
  const itemsToRender = showAllWithdrawals ? withdrawals : withdrawals.slice(0, limit);
  
  let html = itemsToRender.map(w => {
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
    const safeErrorMsg = escapeHTML(w.error_message || '');
    const gatewayTx = w.gateway_tx_id ? `<code>${escapeHTML(w.gateway_tx_id)}</code>` : `<span class="text-muted" title="${safeErrorMsg || 'Aguardando processamento'}">-</span>`;
    
    return `
      <tr>
        <td data-label="Valor"><strong>R$ ${w.amount.toFixed(2).replace('.', ',')}</strong></td>
        <td data-label="Status"><span class="badge ${badgeClass}" title="${safeErrorMsg}">${badgeLabel}</span></td>
        <td data-label="Gateway TX">${gatewayTx}</td>
        <td data-label="Data">${formattedDate}</td>
      </tr>
    `;
  }).join('');
  
  if (!showAllWithdrawals && withdrawals.length > limit) {
    html += `
      <tr>
        <td colspan="4" style="text-align: center; padding: 12px; background: transparent; border-bottom: none;">
          <button class="btn" style="font-size: 0.8rem; padding: 6px 16px; border-radius: 20px; background: #e2e8f0; color: #475569; font-weight: 600; cursor: pointer; border: none;" onclick="toggleWithdrawals()">
            Ver todos os ${withdrawals.length} saques <i class="fa-solid fa-chevron-down"></i>
          </button>
        </td>
      </tr>
    `;
  } else if (showAllWithdrawals && withdrawals.length > limit) {
    html += `
      <tr>
        <td colspan="4" style="text-align: center; padding: 12px; background: transparent; border-bottom: none;">
          <button class="btn" style="font-size: 0.8rem; padding: 6px 16px; border-radius: 20px; background: #e2e8f0; color: #475569; font-weight: 600; cursor: pointer; border: none;" onclick="toggleWithdrawals()">
            Ver menos <i class="fa-solid fa-chevron-up"></i>
          </button>
        </td>
      </tr>
    `;
  }
  
  withdrawalsTableBody.innerHTML = html;
}

window.toggleWithdrawals = function() {
  showAllWithdrawals = !showAllWithdrawals;
  renderWithdrawals(userWithdrawalsCache);
};

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
      withdrawStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> Solicitação criada! O PIX será enviado em até 24 horas.`;
      withdrawStatus.classList.remove('hidden');
      withdrawAmountInput.value = '';
      
      // Atualiza a tela imediatamente
      await fetchWalletData();
      
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
// Atualiza o painel instantaneamente quando o usuário volta para a aba
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sessionToken) {
    fetchWalletData();
  }
});

async function fetchSitesList() {
  try {
    const res = await fetch('/api/v1/sites/list');
    const body = await res.json();
    if (body.status === 'success') {
      cachedSites = body.data;
      updateSitesList();
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

  // Agrupa os sites pelo domínio principal
  const grouped = {};
  for (const s of sites) {
    if (!grouped[s.domain]) {
      grouped[s.domain] = {
        domain: s.domain,
        pages: []
      };
    }
    grouped[s.domain].pages.push(s);
  }

  // Renderiza a lista de cartões agrupados
  sitesListGrid.innerHTML = Object.values(grouped)
    .sort((a, b) => a.domain.localeCompare(b.domain))
    .map(group => {
      const isDemo = group.domain === 'localhost:3000';
      const iconClass = isDemo ? 'fa-graduation-cap text-cyan' : 'fa-globe text-purple';
      
      // Ordena as páginas: Página Principal primeiro, depois por ordem alfabética da URL
      group.pages.sort((x, y) => {
        const xUrl = x.blog_url || '';
        const yUrl = y.blog_url || '';
        if (!xUrl || xUrl === '/') return -1;
        if (!yUrl || yUrl === '/') return 1;
        return xUrl.localeCompare(yUrl);
      });

      // Gera o HTML para cada subpágina do domínio
      const pagesHtml = group.pages.map(p => {
        let pageLabel = 'Página Principal';
      if (p.blog_url && p.blog_url !== '/' && p.blog_url !== '') {
        // Converte slugs como /apostas-esportivas/ em rótulos bonitos "Apostas Esportivas"
        pageLabel = p.blog_url
          .replace(/^\/+|\/+$/g, '')
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
          
        if (pageLabel.toLowerCase() === 'e confiavel') {
          pageLabel = 'É Confiável';
        } else if (pageLabel.toLowerCase() === 'cassino online') {
          pageLabel = 'Cassino Online';
        }
      }

      // Escolha do ícone específico com base na subpágina
      let pageIcon = '<i class="fa-solid fa-house" style="color: var(--purple); font-size: 0.9rem;"></i>';
      if (pageLabel.toLowerCase().includes('esportivas') || pageLabel.toLowerCase().includes('esportes')) {
        pageIcon = '<i class="fa-solid fa-trophy" style="color: #f59e0b; font-size: 0.9rem;"></i>';
      } else if (pageLabel.toLowerCase().includes('cassino') || pageLabel.toLowerCase().includes('online')) {
        pageIcon = '<i class="fa-solid fa-dice" style="color: #8b5cf6; font-size: 0.9rem;"></i>';
      } else if (pageLabel.toLowerCase().includes('confiável') || pageLabel.toLowerCase().includes('confiavel')) {
        pageIcon = '<i class="fa-solid fa-shield-halved" style="color: #10b981; font-size: 0.9rem;"></i>';
      }

      let targetUrl = p.blog_url || '';
      if (!targetUrl.startsWith('http') && p.blog_url) {
        const domainBase = group.domain.startsWith('http') ? group.domain : `https://${group.domain}`;
        targetUrl = domainBase + (p.blog_url.startsWith('/') ? p.blog_url : `/${p.blog_url}`);
      }
      
      // Se for local demo-site, mantém relativo
      if (isDemo) {
        targetUrl = p.blog_url;
      }

      if (targetUrl) {
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl += separator + 'cp=1';
      }

      const isVip = sessionUser && sessionUser.name && sessionUser.name.toLowerCase().includes('alexandre');
      const hasCommented = !isVip && userCommentsCache.some(c => c.site_id === p.id && (c.status === 'pending' || c.status === 'approved'));

      let actionBtn = '';
      if (hasCommented) {
        actionBtn = `
          <button disabled class="btn" style="background: #e2e8f0; color: #94a3b8; cursor: not-allowed; border: 1px solid #cbd5e1; padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
            <i class="fa-solid fa-lock" style="font-size: 0.75rem;"></i> Bloqueado
          </button>
        `;
      } else {
        actionBtn = `
          <a href="${targetUrl}" target="_blank" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.75rem;"></i> Acessar
          </a>
        `;
      }

      return `
        <div class="subpage-row" style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; gap: 12px; margin-top: 8px; transition: var(--transition-smooth);">
          <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: var(--shadow-sm);">
              ${pageIcon}
            </div>
            <div style="display: flex; flex-direction: column; min-width: 0;">
              <span style="font-size: 0.85rem; font-weight: 600; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(pageLabel)}</span>
              <span style="font-size: 0.75rem; color: var(--green-text); font-weight: 700; display: inline-flex; align-items: center; gap: 2px;"><i class="fa-solid fa-wallet" style="font-size: 0.7rem;"></i> R$ ${p.reward_amount.toFixed(2).replace('.', ',')}</span>
            </div>
          </div>
          <div style="flex-shrink: 0;">
            ${actionBtn}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="site-card-item" style="flex-direction: column; align-items: stretch; gap: 16px; min-width: 0; width: 100%;">
        <div style="display: flex; gap: 16px; align-items: center; border-bottom: 1px solid var(--card-border); padding-bottom: 16px; width: 100%;">
          <div class="site-card-logo" style="box-shadow: var(--shadow-sm);">
            <i class="fa-solid ${iconClass}"></i>
          </div>
          <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
            <h4 style="margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1.1rem; font-family: 'Outfit', sans-serif; color: var(--text-primary); font-weight: 700;">${escapeHTML(group.domain)}</h4>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">${group.pages.length} ${group.pages.length === 1 ? 'página disponível' : 'páginas disponíveis'}</span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
          ${pagesHtml}
        </div>
      </div>
    `;
  }).join('');
}

// Filtro de Busca
function updateSitesList() {
  const query = sitesSearchInput ? sitesSearchInput.value.toLowerCase().trim() : '';
  if (!query) {
    renderSitesList(cachedSites);
  } else {
    const filtered = cachedSites.filter(s => 
      (s.name && s.name.toLowerCase().includes(query)) || 
      (s.domain && s.domain.toLowerCase().includes(query))
    );
    renderSitesList(filtered);
  }
}

if (sitesSearchInput) {
  sitesSearchInput.addEventListener('input', updateSitesList);
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
