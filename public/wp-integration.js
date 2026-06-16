/**
 * CommentPay - WordPress Native Comment Form Integration Script
 * This script runs client-side on the WordPress blog post page.
 */
(function() {
  // Define Hub URL - dynamically read from script tag or fallback to localhost
  let HUB_URL = window.commentpayHubUrl;
  if (!HUB_URL) {
    const currentScript = document.currentScript;
    if (currentScript && currentScript.src) {
      try {
        HUB_URL = new URL(currentScript.src).origin;
      } catch (e) {
        HUB_URL = 'http://localhost:3000';
      }
    } else {
      HUB_URL = 'http://localhost:3000';
    }
  }
  
  // Check Activation (only show if referred from CommentPay or already logged in)
  const urlParams = new URLSearchParams(window.location.search);
  const isFromCommentPayLink = urlParams.has('cp') || urlParams.get('utm_source') === 'commentpay';
  
  if (isFromCommentPayLink) {
    sessionStorage.setItem('commentpay_active', '1');
  }

  // Handling redirect fallback for SSO
  if (urlParams.has('cp_token')) {
    const fallbackToken = urlParams.get('cp_token');
    const fallbackUserStr = urlParams.get('cp_user');
    try {
      if (fallbackToken && fallbackUserStr) {
        const fallbackUser = JSON.parse(decodeURIComponent(fallbackUserStr));
        localStorage.setItem('commentpay_token', fallbackToken);
        localStorage.setItem('commentpay_user', JSON.stringify(fallbackUser));
        sessionStorage.setItem('commentpay_active', '1');
      }
      
      // Clean up URL
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('cp_token');
      cleanUrl.searchParams.delete('cp_user');
      window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search);
    } catch(e) {}
  }
  
  let token = localStorage.getItem('commentpay_token') || null;
  let user = null;
  try {
    const userJson = localStorage.getItem('commentpay_user');
    if (userJson) user = JSON.parse(userJson);
  } catch(e) {
    console.error('[CommentPay] Error parsing user details:', e);
  }

  const isActiveSession = sessionStorage.getItem('commentpay_active') === '1';
  
  if (!isActiveSession) {
    // Silent mode for organic visitors
    return;
  }

  // Sincroniza o input oculto no formulário do WordPress com o token atual
  function syncHiddenInput() {
    const commentForm = document.getElementById('commentform') || document.querySelector('form.comment-form');
    if (!commentForm) return;
    
    let hiddenInput = document.getElementById('commentpay_token_input');
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.name = 'commentpay_token';
      hiddenInput.id = 'commentpay_token_input';
      commentForm.appendChild(hiddenInput);
    }
    hiddenInput.value = token || '';
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
      color: #16a34a;
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
      background: #16a34a;
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
      background: #15803d;
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
      bottom: 24px;
      right: 24px;
      background: #0f172a;
      color: white;
      padding: 12px 20px;
      border-radius: 30px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 0.9rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      z-index: 999999;
      transition: all 0.3s ease;
    }
    .commentpay-wp-floating-badge:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(0,0,0,0.2);
    }
    .commentpay-wp-floating-badge.connected {
      background: #ffffff;
      color: #0f172a;
      border: 1px solid #e2e8f0;
    }
    .commentpay-minigame-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(15, 23, 42, 0.85);
      z-index: 9999999;
      display: flex; justify-content: center; align-items: center;
      backdrop-filter: blur(5px);
    }
    .commentpay-minigame-modal {
      background: #fff; border-radius: 16px; padding: 24px;
      text-align: center; max-width: 350px; width: 90%;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
      position: relative;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .commentpay-minigame-close {
      position: absolute; top: 12px; right: 16px;
      cursor: pointer; font-size: 24px; color: #94a3b8;
    }
    .commentpay-minigame-close:hover { color: #0f172a; }
    .commentpay-roulette-container {
      width: 200px; height: 200px; margin: 20px auto;
      border-radius: 50%; border: 5px solid #16a34a;
      position: relative; overflow: hidden;
      background: conic-gradient(#fcd34d 0deg 18deg, #e2e8f0 18deg 360deg);
      transition: transform 4s cubic-bezier(0.25, 1, 0.5, 1);
    }
    .commentpay-roulette-pointer {
      position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
      width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 20px solid #ef4444;
      z-index: 10;
    }
  `;
  document.head.appendChild(style);

  // Helper to open SSO Login Popup
  function openLoginPopup() {
    const width = 600;
    const height = 720;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;
    
    const returnUrl = encodeURIComponent(window.location.href);
    
    // Open Central Hub in a popup window
    const popup = window.open(
      `${HUB_URL}/dashboard?sso_return=${returnUrl}`,
      'CommentPaySSO',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
    );

    if (!popup) {
      // Fallback direto se popup for bloqueado completamente
      window.location.href = `${HUB_URL}/dashboard?sso_return=${returnUrl}`;
    }
  }

  // Listen for SSO messages from Central Hub
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'SSO_SUCCESS') {
      token = event.data.token;
      user = event.data.user;
      
      try {
        localStorage.setItem('commentpay_token', token);
        localStorage.setItem('commentpay_user', JSON.stringify(user));
      } catch (storageErr) {
        console.warn('LocalStorage bloqueado, a sessão pode não persistir após recarregar.', storageErr);
      }
      
      syncHiddenInput();
      
      let hasPendingSpin = false;
      try {
        hasPendingSpin = sessionStorage.getItem('pending_anonymous_spin');
        if (hasPendingSpin) sessionStorage.removeItem('pending_anonymous_spin');
      } catch(e) {}

      if (hasPendingSpin) {
         // Silent real spin
         fetch(`${HUB_URL}/api/v1/minigame/spin`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
             body: JSON.stringify({ domain: window.location.hostname, path: window.location.pathname })
         }).catch(e => console.error(e)).finally(() => initOrUpdateIntegration());
      } else {
        initOrUpdateIntegration();
      }
      
      console.log('[CommentPay] Conectado com sucesso!', user.name);
      
      // Se tivermos um overlay de minigame aberto pedindo login, fecha ele e recarrega integration
      const overlay = document.getElementById('commentpay-minigame-overlay');
      if (overlay) overlay.remove();
            if (sessionStorage.getItem('pending_anonymous_spin')) {
           sessionStorage.removeItem('pending_anonymous_spin');
           // Silent real spin
           fetch(`${HUB_URL}/api/v1/minigame/spin`, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
               body: JSON.stringify({ domain: window.location.hostname, path: window.location.pathname })
           }).catch(e => console.error(e)).finally(() => initOrUpdateIntegration());
        } else {
        initOrUpdateIntegration();
      }
    }
  });

  // Logout/Disconnect
  function disconnect() {
    localStorage.removeItem('commentpay_token');
    localStorage.removeItem('commentpay_user');
    sessionStorage.removeItem('commentpay_active');
    token = null;
    user = null;
    syncHiddenInput();
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
    
    // Sync Hidden Input
    syncHiddenInput();

    // Se estiver logado, verifica se já comentou neste site e traz status do minigame
    let siteStatus = null;
    if (token) {
      try {
        const domain = window.location.hostname;
        const path = window.location.pathname;
        const res = await fetch(`${HUB_URL}/api/v1/user/site-status?domain=${encodeURIComponent(domain)}&path=${encodeURIComponent(path)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.status === 401) {
          console.warn('[CommentPay] Sessão expirada. Desconectando.');
          disconnect();
          return;
        }
        
        const data = await res.json();
        
        if (data.status === 'success') {
          siteStatus = data;
          
          if (data.has_commented) {
            console.log('[CommentPay] Usuário já comentou neste site. Ocultando widget.');
            // Remove badge and banner se existirem
            const banner = document.getElementById('commentpay-form-banner');
            if (banner) banner.remove();
            const floatingBadge = document.getElementById('commentpay-floating-badge');
            if (floatingBadge) floatingBadge.remove();
            return; 
          }
          
          // Se não comentou e NÃO jogou o minigame, exibe a roleta automaticamente
          if (!data.has_played_minigame && !sessionStorage.getItem('commentpay_minigame_shown')) {
            showMinigameModal(domain, path);
          }
        }
      } catch (e) {
        console.error('[CommentPay] Erro ao verificar status do site:', e);
      }
    } else {
      // Se não estiver logado, exibe a roleta para instigar o login
      if (!sessionStorage.getItem('commentpay_minigame_shown')) {
        showMinigameModal(window.location.hostname, window.location.pathname);
      }
    }

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
          Este artigo participa do programa de comentários qualificados. Conecte sua conta do <strong>Central Hub ComentariosLucrativos</strong> antes de comentar para receber a recompensa diretamente na sua carteira.
        </p>
        <div>
          <button type="button" class="commentpay-wp-btn" id="commentpay-connect-btn">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:-3px;"><path stroke-linecap="round" stroke-linejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
            Conectar Carteira ComentariosLucrativos
          </button>
        </div>
      `;
      document.getElementById('commentpay-connect-btn').addEventListener('click', openLoginPopup);
    } else {
      banner.innerHTML = `
        <div class="commentpay-wp-title">
          <span>✅ Carteira ComentariosLucrativos Conectada!</span>
        </div>
        <div class="commentpay-wp-connected">
          <div class="commentpay-wp-user-badge">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" style="color: #10b981;"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            <span>Identificado: <strong>${escapeHtml(user.name)}</strong></span>
          </div>
          <div>
            <span style="font-size: 0.8rem; color: #10b981; font-weight:600; margin-right: 12px;">
              ${siteStatus && siteStatus.active_bonus > 1.0 ? `🔥 + R$ ${(0.50 * siteStatus.active_bonus).toFixed(2).replace('.',',')} ao comentar (Bônus 2x)` : `+ R$ 0,50 ao comentar`}
            </span>
            <button type="button" class="commentpay-wp-logout" id="commentpay-disconnect-btn">Desconectar</button>
          </div>
        </div>
        <p class="commentpay-wp-desc" style="margin-top: 10px; margin-bottom: 0; font-size: 0.75rem; color: #64748b;">
          * O comentário deve ter pelo menos 50 caracteres e respeitar as regras anti-fraude. O saldo ficará pendente até ser aprovado pelos administradores.
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
    const initialTextarea = document.getElementById('comment') || commentForm.querySelector('textarea[name="comment"]') || commentForm.querySelector('textarea');
    if (initialTextarea) {
      let counterDiv = document.getElementById('commentpay-char-counter');
      if (!counterDiv) {
        counterDiv = document.createElement('div');
        counterDiv.id = 'commentpay-char-counter';
        initialTextarea.parentNode.insertBefore(counterDiv, initialTextarea.nextSibling);
      }
      
      const updateCounter = () => {
        // Sempre busca o textarea atual para evitar problemas caso o tema modifique o DOM
        const currentTextarea = document.getElementById('comment') || commentForm.querySelector('textarea[name="comment"]') || commentForm.querySelector('textarea');
        if (!currentTextarea) return;
        
        const len = currentTextarea.value.trim().length;
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
      
      // Usa delegação de eventos no formulário para capturar digitação mesmo se o textarea for recriado/modificado
      commentForm.addEventListener('input', updateCounter);
      commentForm.addEventListener('keyup', updateCounter);
      commentForm.addEventListener('change', updateCounter);
      
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

  // Minigame Modal Logic
  function showMinigameModal(domain, path) {
    if (localStorage.getItem('commentpay_minigame_shown')) return;
    localStorage.setItem('commentpay_minigame_shown', '1');
    let overlay = document.getElementById('commentpay-minigame-overlay');
    if (overlay) return;

    if (!document.getElementById('commentpay-minigame-styles')) {
      const style = document.createElement('style');
      style.id = 'commentpay-minigame-styles';
      style.innerHTML = `
        .commentpay-minigame-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.85); z-index: 9999999;
          display: flex; justify-content: center; align-items: center;
          backdrop-filter: blur(5px);
        }
        .commentpay-minigame-overlay * {
          box-sizing: border-box !important;
        }
        .commentpay-minigame-modal {
          background: linear-gradient(180deg, #1e3a8a 0%, #0f172a 100%);
          border-radius: 20px; padding: 30px 20px;
          text-align: center; max-width: 380px; width: 90%;
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,255,255,0.1);
          position: relative; font-family: 'Outfit', 'Inter', sans-serif;
          color: white;
        }
        .commentpay-minigame-close {
          position: absolute; top: 12px; right: 16px;
          cursor: pointer; font-size: 24px; color: rgba(255,255,255,0.6);
          transition: color 0.2s;
        }
        .commentpay-minigame-close:hover { color: #fff; }
        .commentpay-title {
          font-family: 'Outfit', sans-serif; font-size: 2.2rem; font-weight: 800;
          text-transform: uppercase; letter-spacing: 1px;
          margin: 0 0 5px 0; color: #ffd700;
          text-shadow: 2px 2px 0px #0f172a, 4px 4px 0px rgba(0,0,0,0.3);
        }
        .commentpay-subtitle {
          font-size: 0.95rem; font-weight: 500; margin-bottom: 25px;
          color: #f8fafc; font-family: 'Inter', sans-serif;
        }
        .commentpay-wheel-wrapper {
          position: relative; width: 260px; height: 260px; margin: 0 auto 30px auto;
          border-radius: 50%; background: #0f172a; padding: 8px;
          box-shadow: 0 10px 20px rgba(0,0,0,0.4);
        }
        .commentpay-wheel-wrapper::before {
          content: ''; position: absolute; top: 4px; left: 4px; right: 4px; bottom: 4px;
          border-radius: 50%; border: 3px dotted rgba(255,255,255,0.3); pointer-events: none;
        }
        .commentpay-roulette-container {
          width: 100%; height: 100%; border-radius: 50%;
          position: relative; overflow: hidden;
          border: none !important; margin: 0 !important; outline: none !important;
          background: conic-gradient(
            from -22.5deg,
            #ffd700 0deg 45deg,
            #1e3a8a 45deg 90deg,
            #ffffff 90deg 135deg,
            #0f172a 135deg 180deg,
            #1e3a8a 180deg 225deg,
            #ffffff 225deg 270deg,
            #0f172a 270deg 315deg,
            #1e3a8a 315deg 360deg
          );
          box-shadow: inset 0 0 15px rgba(0,0,0,0.5);
          transition: transform 10s cubic-bezier(0.2, 0.8, 0.1, 1);
        }
        .commentpay-slice {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          display: flex; justify-content: center;
        }
        .commentpay-slice span {
          margin-top: 15px; font-weight: 800; font-size: 0.75rem; color: white;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.8); letter-spacing: 0.5px;
          width: 60px; text-align: center; line-height: 1.1;
        }
        .commentpay-slice.text-dark span { color: #0f172a; text-shadow: none; font-size: 0.85rem; }
        .commentpay-slice.text-gold span { color: #ffd700; text-shadow: 1px 1px 2px rgba(0,0,0,0.8); }
        .commentpay-slice-line {
          position: absolute; top: 0; left: 50%; width: 2px; height: 50%;
          background: rgba(0,0,0,0.15); transform-origin: bottom center;
        }
        .commentpay-center-hub {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: 50px; height: 50px; border-radius: 50%;
          background: radial-gradient(circle, #3b82f6 0%, #1e3a8a 100%);
          border: 4px solid #ffd700;
          box-shadow: 0 4px 10px rgba(0,0,0,0.5), inset 0 2px 5px rgba(255,255,255,0.3);
          z-index: 10; display: flex; justify-content: center; align-items: center;
        }
        .commentpay-center-hub::after {
          content: '↻'; color: white; font-size: 24px; font-weight: bold;
        }
        .commentpay-roulette-pointer {
          position: absolute; top: -15px; left: 50%; transform: translateX(-50%);
          width: 32px; height: 42px; z-index: 20;
        }
        .commentpay-roulette-pointer svg {
          width: 100%; height: 100%; filter: drop-shadow(0 4px 4px rgba(0,0,0,0.5));
        }
        .commentpay-spin-btn {
          background: #3b82f6;
          color: #ffffff; padding: 18px; width: 100%; border: none; border-radius: 30px;
          font-weight: 800; font-size: 1.2rem; cursor: pointer; font-family: 'Outfit', sans-serif;
          text-transform: uppercase; 
          box-shadow: 0 0 15px #3b82f6, inset 0 0 10px rgba(255,255,255,0.3);
          text-shadow: 0 0 5px rgba(255,255,255,0.8);
          transition: transform 0.1s, box-shadow 0.1s; margin-top: 10px;
        }
        .commentpay-spin-btn:active {
          transform: scale(0.95); box-shadow: 0 0 5px #3b82f6;
        }
        .commentpay-spin-btn:disabled {
          opacity: 0.7; cursor: not-allowed; transform: none; box-shadow: 0 0 5px #3b82f6;
        }
      `;
      document.head.appendChild(style);
    }

    overlay = document.createElement('div');
    overlay.id = 'commentpay-minigame-overlay';
    overlay.className = 'commentpay-minigame-overlay';
    overlay.innerHTML = `
      <div class="commentpay-minigame-modal">
        <div class="commentpay-minigame-close" id="commentpay-minigame-close">&times;</div>
        <h2 class="commentpay-title">SUPERSPIN</h2>
        <p class="commentpay-subtitle">Tente ganhar nosso super Jackpot! Gire agora!</p>
        
        <div class="commentpay-wheel-wrapper">
          <div class="commentpay-roulette-pointer">
            <svg viewBox="0 0 24 36" fill="white">
              <path d="M12 36 L0 12 A12 12 0 0 1 24 12 Z" fill="#ffd700" stroke="#0f172a" stroke-width="1"/>
              <circle cx="12" cy="12" r="5" fill="#3b82f6"/>
            </svg>
          </div>
          <div class="commentpay-roulette-container" id="commentpay-roulette-wheel">
            <!-- Slices Lines (borders) -->
            <div class="commentpay-slice-line" style="transform: rotate(22.5deg);"></div>
            <div class="commentpay-slice-line" style="transform: rotate(67.5deg);"></div>
            <div class="commentpay-slice-line" style="transform: rotate(112.5deg);"></div>
            <div class="commentpay-slice-line" style="transform: rotate(157.5deg);"></div>
            <div class="commentpay-slice-line" style="transform: rotate(202.5deg);"></div>
            <div class="commentpay-slice-line" style="transform: rotate(247.5deg);"></div>
            <div class="commentpay-slice-line" style="transform: rotate(292.5deg);"></div>
            <div class="commentpay-slice-line" style="transform: rotate(337.5deg);"></div>
            
            <!-- Texts -->
            <div class="commentpay-slice text-dark" style="transform: rotate(0deg);"><span><br>X2</span></div>
            <div class="commentpay-slice text-gold" style="transform: rotate(45deg);"><span><br>X3</span></div>
            <div class="commentpay-slice text-dark" style="transform: rotate(90deg);"><span><br>X1</span></div>
            <div class="commentpay-slice text-gold" style="transform: rotate(135deg);"><span>TENTE<br>DE NOVO</span></div>
            <div class="commentpay-slice text-gold" style="transform: rotate(180deg);"><span><br>X1</span></div>
            <div class="commentpay-slice text-dark" style="transform: rotate(225deg);"><span>NÃO FOI<br>DESSA VEZ</span></div>
            <div class="commentpay-slice text-gold" style="transform: rotate(270deg);"><span><br>X2</span></div>
            <div class="commentpay-slice text-gold" style="transform: rotate(315deg);"><span><br>X1</span></div>
            
            <div class="commentpay-center-hub"></div>
          </div>
        </div>
        
        <button class="commentpay-spin-btn" id="commentpay-spin-btn">GIRE AGORA</button>
        <p id="commentpay-spin-result" style="margin-top:15px; font-weight:800; min-height:20px; font-size:1.1rem; color:#ffd700;"></p>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('commentpay-minigame-close').addEventListener('click', () => {
      overlay.remove();
    });

    const spinBtn = document.getElementById('commentpay-spin-btn');
    spinBtn.addEventListener('click', async () => {
      spinBtn.disabled = true;
      spinBtn.innerText = 'GIRANDO...';
      
      if (!token) {
        // Mock gamification spin se deslogado
        const wheel = document.getElementById('commentpay-roulette-wheel');
        const resultText = document.getElementById('commentpay-spin-result');
        
        let chance = Math.random() * 100;
        let mockMultiplier = 1.0;
        if (chance <= 5) mockMultiplier = 2.0;
        else if (chance <= 35) mockMultiplier = -1;

        let targetDeg = 0;
        if (mockMultiplier === 2.0) targetDeg = 360 * 10 + 0;
        else if (mockMultiplier === -1) targetDeg = 360 * 10 + 135;
        else targetDeg = 360 * 10 + 180;
        
        wheel.style.transform = `rotate(-${targetDeg}deg)`;
        
        setTimeout(() => {
          if (mockMultiplier === 2.0) {
            document.querySelector('.commentpay-minigame-modal').classList.add('victory');
            resultText.style.color = '#10b981';
            resultText.style.textShadow = '0 0 10px rgba(16, 185, 129, 0.8)';
            resultText.innerText = '🎉 VOCÊ GANHOU 2X! Conecte para resgatar!';
            spinBtn.innerText = 'CONECTAR CARTEIRA';
            spinBtn.disabled = false;
            spinBtn.onclick = () => { 
              sessionStorage.setItem('pending_anonymous_spin', '1');
              openLoginPopup(); 
            };
          } else if (mockMultiplier === -1) {
            resultText.style.color = '#ffd700';
            resultText.innerText = 'QUASE! Você ganhou um giro extra!';
            spinBtn.innerText = 'GIRAR NOVAMENTE';
            spinBtn.disabled = false;
            spinBtn.onclick = () => {
               spinBtn.disabled = true;
               spinBtn.innerText = 'GIRANDO...';
               let newDeg = targetDeg + 360 * 10 + 90; // Vai para 225 (NÃO FOI DESSA VEZ)
               wheel.style.transform = `rotate(-${newDeg}deg)`;
               setTimeout(() => {
                  resultText.style.color = '#ffcccc';
                  resultText.innerText = 'NÃO FOI DESSA VEZ. Conecte-se e ganhe R$ 0,50!';
                  spinBtn.innerText = 'CONECTAR CARTEIRA';
                  spinBtn.disabled = false;
                  spinBtn.onclick = () => { openLoginPopup(); };
               }, 10100);
            };
          } else {
            resultText.style.color = '#ffcccc';
            resultText.innerText = 'NÃO FOI DESSA VEZ. Conecte-se e ganhe R$ 0,50!';
            spinBtn.innerText = 'CONECTAR CARTEIRA';
            spinBtn.disabled = false;
            spinBtn.onclick = () => { openLoginPopup(); };
          }
        }, 10100);
        return;
      }

      try {
        const res = await fetch(`${HUB_URL}/api/v1/minigame/spin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ domain, path })
        });
        
        if (res.status === 401) {
           alert("Sessão expirada. Conecte sua carteira novamente.");
           overlay.remove();
           disconnect();
           return;
        }
        
        const data = await res.json();
        
        if (data.status === 'success') {
          const wheel = document.getElementById('commentpay-roulette-wheel');
          const resultText = document.getElementById('commentpay-spin-result');
          
          let currentRotation = parseFloat(wheel.style.transform.replace(/[^0-9.-]/g, '')) || 0;
          let baseTurns = Math.abs(currentRotation) + (360 * 10);
          
          let targetDeg = 0;
          if (data.multiplier === 2.0) targetDeg = baseTurns + 0;
          else if (data.multiplier === -1) targetDeg = baseTurns + 135;
          else targetDeg = baseTurns + 180;
          
          wheel.style.transform = `rotate(-${targetDeg}deg)`;
          
          setTimeout(() => {
            if (data.multiplier === 2.0) {
              document.querySelector('.commentpay-minigame-modal').classList.add('victory');
              resultText.style.color = '#10b981';
              resultText.style.textShadow = '0 0 10px rgba(16, 185, 129, 0.8)';
              resultText.innerText = '🎉 VOCÊ GANHOU 2X!';
              spinBtn.innerText = 'BÔNUS ATIVO!';
              setTimeout(() => { overlay.remove(); initOrUpdateIntegration(); }, 3000);
            } else if (data.multiplier === -1) {
              resultText.style.color = '#ffd700';
              resultText.innerText = 'QUASE! Você ganhou um giro extra!';
              spinBtn.innerText = 'GIRAR NOVAMENTE';
              spinBtn.disabled = false;
            } else {
              resultText.style.color = '#ffcccc';
              resultText.innerText = 'NÃO FOI DESSA VEZ.';
              spinBtn.innerText = 'FEITO!';
              setTimeout(() => { overlay.remove(); initOrUpdateIntegration(); }, 3000);
            }
          }, 10100);
          
        } else {
          alert(data.message || 'Erro ao girar a roleta.');
          spinBtn.disabled = false;
          spinBtn.innerText = 'Tentar Novamente';
          spinBtn.style.opacity = '1';
        }
      } catch (e) {
        console.error(e);
        alert('Erro de conexão ao girar a roleta.');
        spinBtn.disabled = false;
        spinBtn.innerText = 'Girar Agora!';
        spinBtn.style.opacity = '1';
      }
    });
  }

  // Run on load
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initOrUpdateIntegration();
  } else {
    document.addEventListener('DOMContentLoaded', initOrUpdateIntegration);
  }
})();
