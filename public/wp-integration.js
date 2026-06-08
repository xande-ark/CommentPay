/**
 * CommentPay - WordPress Native Comment Form Integration Script
 * This script runs client-side on the WordPress blog post page.
 */
(function() {
  // Define Hub URL - dynamically read from global variable or default to local/tunnel endpoint
  const HUB_URL = window.commentpayHubUrl || 'https://8283eba5b1a8c5fe-138-219-202-201.serveousercontent.com';
  
  // Check Activation (only show if referred from CommentPay or already logged in)
  const urlParams = new URLSearchParams(window.location.search);
  const isFromCommentPayLink = urlParams.has('cp') || urlParams.get('utm_source') === 'commentpay';
  
  if (isFromCommentPayLink) {
    sessionStorage.setItem('commentpay_active', '1');
  }
  
  let token = localStorage.getItem('commentpay_token') || null;
  const isActiveSession = sessionStorage.getItem('commentpay_active') === '1';
  
  if (!isActiveSession) {
    // Silent mode for organic visitors
    return;
  }

  // State
  let user = null;
  try {
    const userJson = localStorage.getItem('commentpay_user');
    if (userJson) user = JSON.parse(userJson);
  } catch(e) {
    console.error('[CommentPay] Error parsing user details:', e);
  }

  // Inject Styles
  const style = document.createElement('style');
  style.innerHTML = `
    .commentpay-wp-box {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
      color: #0f172a;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .commentpay-wp-box a, .commentpay-wp-box button {
      transition: all 0.2s ease;
    }
    .commentpay-wp-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #2563eb;
      margin-top: 0;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .commentpay-wp-desc {
      font-size: 0.85rem;
      color: #475569;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .commentpay-wp-btn {
      background: #2563eb;
      border: none;
      color: white;
      padding: 8px 16px;
      font-size: 0.85rem;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none !important;
    }
    .commentpay-wp-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
      background: #1d4ed8;
    }
    .commentpay-wp-connected {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .commentpay-wp-user-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      background: rgba(37, 99, 235, 0.05);
      border: 1px solid rgba(37, 99, 235, 0.15);
      padding: 6px 12px;
      border-radius: 20px;
    }
    .commentpay-wp-user-badge i {
      color: #10b981;
    }
    .commentpay-wp-logout {
      font-size: 0.75rem;
      color: #64748b;
      background: transparent;
      border: none;
      text-decoration: underline;
      cursor: pointer;
      padding: 0;
    }
    .commentpay-wp-logout:hover {
      color: #ef4444;
    }
    .commentpay-wp-floating-badge {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
      padding: 10px 16px;
      border-radius: 30px;
      color: #0f172a;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 99999;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .commentpay-wp-floating-badge:hover {
      transform: scale(1.05) translateY(-2px);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.15);
      border-color: #cbd5e1;
    }
    .commentpay-wp-floating-badge.connected i {
      color: #10b981;
    }
  `;
  document.head.appendChild(style);

  // Helper to open SSO Login Popup
  function openLoginPopup() {
    const width = 600;
    const height = 720;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;
    
    // Open Central Hub in a popup window
    const popup = window.open(
      `${HUB_URL}/index.html`,
      'CommentPaySSO',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
    );

    if (!popup) {
      alert('Por favor, libere os popups neste site para conectar com a CommentPay.');
    }
  }

  // Listen for SSO messages from Central Hub
  window.addEventListener('message', function(event) {
    if (event.origin !== HUB_URL) {
      // Just check if it's the Hub we expect
      if (!HUB_URL.includes(event.origin)) return;
    }

    if (event.data && event.data.type === 'SSO_SUCCESS') {
      token = event.data.token;
      user = event.data.user;
      
      localStorage.setItem('commentpay_token', token);
      localStorage.setItem('commentpay_user', JSON.stringify(user));
      
      console.log('[CommentPay] Conectado com sucesso!', user.name);
      initOrUpdateIntegration();
    }
  });

  // Logout/Disconnect
  function disconnect() {
    localStorage.removeItem('commentpay_token');
    localStorage.removeItem('commentpay_user');
    sessionStorage.removeItem('commentpay_active');
    token = null;
    user = null;
    window.location.reload(); // Reload to clean up and hide the widget completely
  }

  // Render & Update UI Elements
  async function initOrUpdateIntegration() {
    // 1. Locate WordPress Comment Form (usually #commentform)
    const commentForm = document.getElementById('commentform') || document.querySelector('form.comment-form');
    if (!commentForm) {
      console.warn('[CommentPay] WordPress comment form not found on this page.');
      return;
    }

    // Se estiver logado, verifica se já comentou neste site
    if (token) {
      try {
        const domain = window.location.hostname;
        const path = window.location.pathname;
        const res = await fetch(`${HUB_URL}/api/v1/user/site-status?domain=${encodeURIComponent(domain)}&path=${encodeURIComponent(path)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.status === 'success' && data.has_commented) {
          console.log('[CommentPay] Usuário já comentou neste site. Ocultando widget.');
          // Remove badge and banner if they exist
          const banner = document.getElementById('commentpay-form-banner');
          if (banner) banner.remove();
          const floatingBadge = document.getElementById('commentpay-floating-badge');
          if (floatingBadge) floatingBadge.remove();
          return; // Para a execução, não exibe mais nada do CommentPay
        }
      } catch (e) {
        console.error('[CommentPay] Erro ao verificar status do site:', e);
      }
    }

    // 2. Insert/Update Hidden Input for the token
    let hiddenInput = document.getElementById('commentpay_token_input');
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.name = 'commentpay_token';
      hiddenInput.id = 'commentpay_token_input';
      commentForm.appendChild(hiddenInput);
    }
    hiddenInput.value = token || '';

    // 3. Inject In-Form Banner (before #commentform or before the comments textarea)
    let banner = document.getElementById('commentpay-form-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'commentpay-form-banner';
      banner.className = 'commentpay-wp-box';
      // Inserir antes do formulário ou no topo do formulário
      commentForm.parentNode.insertBefore(banner, commentForm);
    }

    // Update banner content
    if (!token || !user) {
      banner.innerHTML = `
        <div class="commentpay-wp-title">
          <span>💬 Ganhe R$ 0,50 por seu comentário!</span>
        </div>
        <p class="commentpay-wp-desc">
          Este artigo participa do programa de comentários qualificados. Conecte sua conta do <strong>Central Hub CommentPay</strong> antes de comentar para receber a recompensa diretamente na sua carteira.
        </p>
        <div>
          <button type="button" class="commentpay-wp-btn" id="commentpay-connect-btn">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:-3px;"><path stroke-linecap="round" stroke-linejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
            Conectar Carteira CommentPay
          </button>
        </div>
      `;
      document.getElementById('commentpay-connect-btn').addEventListener('click', openLoginPopup);
    } else {
      banner.innerHTML = `
        <div class="commentpay-wp-title">
          <span>✅ Carteira CommentPay Conectada!</span>
        </div>
        <div class="commentpay-wp-connected">
          <div class="commentpay-wp-user-badge">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" style="color: #10b981;"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            <span>Identificado: <strong>${escapeHtml(user.name)}</strong></span>
          </div>
          <div>
            <span style="font-size: 0.8rem; color: #10b981; font-weight:600; margin-right: 12px;">+ R$ 0,50 ao comentar</span>
            <button type="button" class="commentpay-wp-logout" id="commentpay-disconnect-btn">Desconectar</button>
          </div>
        </div>
        <p class="commentpay-wp-desc" style="margin-top: 10px; margin-bottom: 0; font-size: 0.75rem; color: #64748b;">
          * O comentário deve ter pelo menos 50 caracteres e respeitar as regras anti-fraude. O saldo ficará pendente até ser aprovado pelos administradores da Love PG.
        </p>
      `;
      document.getElementById('commentpay-disconnect-btn').addEventListener('click', disconnect);
    }

    // 4. Inject Floating Badge
    let floatingBadge = document.getElementById('commentpay-floating-badge');
    if (!floatingBadge) {
      floatingBadge = document.createElement('div');
      floatingBadge.id = 'commentpay-floating-badge';
      document.body.appendChild(floatingBadge);
    }

    if (!token || !user) {
      floatingBadge.className = 'commentpay-wp-floating-badge';
      floatingBadge.innerHTML = `
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Comente & Ganhe
      `;
      floatingBadge.onclick = openLoginPopup;
    } else {
      floatingBadge.className = 'commentpay-wp-floating-badge connected';
      floatingBadge.innerHTML = `
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:#10b981;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        R$ 0,50 Ativo
      `;
      floatingBadge.onclick = function() {
        commentForm.scrollIntoView({ behavior: 'smooth' });
      };
    }

    // 5. Contador de Caracteres Qualificados para Recompensa
    const commentTextarea = commentForm.querySelector('textarea[name="comment"]') || commentForm.querySelector('textarea');
    if (commentTextarea) {
      let counterDiv = document.getElementById('commentpay-char-counter');
      if (!counterDiv) {
        counterDiv = document.createElement('div');
        counterDiv.id = 'commentpay-char-counter';
        commentTextarea.parentNode.insertBefore(counterDiv, commentTextarea.nextSibling);
      }
      
      const updateCounter = () => {
        const len = commentTextarea.value.trim().length;
        if (!token) {
          counterDiv.style.display = 'none';
          return;
        }
        
        counterDiv.style.display = 'block';
        counterDiv.style.marginTop = '8px';
        counterDiv.style.marginBottom = '12px';
        counterDiv.style.fontSize = '0.825rem';
        counterDiv.style.fontWeight = '600';
        counterDiv.style.padding = '8px 12px';
        counterDiv.style.borderRadius = '8px';
        counterDiv.style.transition = 'all 0.2s ease';
        counterDiv.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        
        if (len < 50) {
          const diff = 50 - len;
          counterDiv.style.background = '#fffbeb';
          counterDiv.style.border = '1px solid #fef3c7';
          counterDiv.style.color = '#d97706';
          counterDiv.innerHTML = `⚠️ Digite mais <strong>${diff}</strong> caracteres para receber a recompensa (Digitados: ${len}/50)`;
        } else {
          counterDiv.style.background = '#f0fdf4';
          counterDiv.style.border = '1px solid #dcfce7';
          counterDiv.style.color = '#16a34a';
          counterDiv.innerHTML = `✅ Limite atingido! Elegível para recompensa de R$ 0,50 (Digitados: ${len}/50)`;
        }
      };
      
      commentTextarea.addEventListener('input', updateCounter);
      updateCounter();
    }
  }

  // Simple HTML Escaper
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Run on load
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initOrUpdateIntegration();
  } else {
    document.addEventListener('DOMContentLoaded', initOrUpdateIntegration);
  }
})();
