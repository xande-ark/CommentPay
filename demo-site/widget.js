// --- CONFIGURAÇÃO E ESTADO DO WIDGET ---
let widgetToken = localStorage.getItem('widget_session_token') || null;
let widgetUser = JSON.parse(localStorage.getItem('widget_session_user')) || null;

// Se o widget rodar no site de produção, direciona as chamadas para o backend local (ou ngrok)
const API_BASE = window.location.origin.includes('localhost') ? '' : 'https://old-views-repeat.loca.lt';

// GERA UM IP ALEATÓRIO PARA CADA SESSÃO DE TESTE
// Isso permite que o usuário teste a plataforma sem travar no IP local 127.0.0.1
if (!sessionStorage.getItem('widget_test_ip')) {
  const randomOctet3 = Math.floor(Math.random() * 254) + 1;
  const randomOctet4 = Math.floor(Math.random() * 254) + 1;
  sessionStorage.setItem('widget_test_ip', `189.120.${randomOctet3}.${randomOctet4}`);
}
const testIp = sessionStorage.getItem('widget_test_ip');

const widgetContainer = document.getElementById('commentpay-widget');
const approvedListContainer = document.getElementById('approved-comments-list');
const siteId = widgetContainer ? (widgetContainer.getAttribute('data-site-id') || 'site-demo-id-123') : 'site-demo-id-123';
const postId = widgetContainer ? (widgetContainer.getAttribute('data-post-id') || '1') : '1';

// --- INICIALIZAÇÃO ---
async function initWidget() {
  await renderWidget();
  loadPublishedComments();
  
  if (!widgetToken) {
    showMinigameModal();
  }
}

// --- RENDERIZAR O WIDGET ---
async function renderWidget() {
  if (!widgetToken || !widgetUser) {
    // ESTADO: DESLOGADO
    widgetContainer.innerHTML = `
      <div class="commentpay-widget-box">
        <div class="commentpay-logged-out">
          <p><i class="fa-solid fa-lock text-purple"></i> Faça login utilizando sua conta do Central Hub para comentar e ser remunerado.</p>
          <button id="btn-widget-login" class="commentpay-btn">
            <i class="fa-solid fa-comments-dollar"></i> Entrar com ComentariosLucrativos
          </button>
        </div>
      </div>
    `;
    
    document.getElementById('btn-widget-login').addEventListener('click', openSSOPopup);
  } else {
    // Fetch active bonus
    let activeBonus = 1.0;
    try {
      const res = await fetch((API_BASE ? API_BASE : '') + `/api/v1/user/site-status?domain=${encodeURIComponent(window.location.hostname || 'localhost')}&path=${encodeURIComponent(window.location.pathname)}`, {
        headers: { 'Authorization': `Bearer ${widgetToken}` }
      });
      const data = await res.json();
      if (data.status === 'success') {
        if (data.active_bonus) activeBonus = data.active_bonus;
        if (!data.has_played_minigame && !data.has_commented) {
          showMinigameModal();
        }
      }
    } catch(e) {}

    // ESTADO: LOGADO
    widgetContainer.innerHTML = `
      <div class="commentpay-widget-box">
        <div class="commentpay-logged-in">
          <div class="user-row">
            <span class="user-info">
              Identificado como: <strong>${escapeHTML(widgetUser.name)}</strong>
            </span>
            <button id="btn-widget-logout" class="btn-disconnect">
              <i class="fa-solid fa-right-from-bracket"></i> Desconectar
            </button>
          </div>
          
          <div class="textarea-container">
            <textarea id="widget-comment-text" class="commentpay-textarea" placeholder="Deixe seu comentário construtivo sobre o artigo aqui... (mínimo de 50 caracteres)"></textarea>
            <div class="char-counter" id="widget-char-counter">0 / 50 caracteres</div>
          </div>
          
          <div id="widget-alert" class="commentpay-alert hidden"></div>
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
            <span style="font-size: 0.8rem; color: #10b981; font-weight: 600;">
              ${activeBonus > 1.0 ? `🔥 Bônus 2X Ativo! (+ R$ ${(0.50 * activeBonus).toFixed(2).replace('.',',')})` : '+ R$ 0,50 ao comentar'}
            </span>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
            <span style="font-size: 0.75rem; color: #64748b;" title="Este IP foi gerado aleatoriamente para simular requisições de IPs distintos localmente.">
              <i class="fa-solid fa-network-wired"></i> IP de Teste: <strong>${testIp}</strong>
            </span>
            <button id="btn-widget-submit" class="commentpay-btn" disabled>
              <i class="fa-solid fa-paper-plane"></i> Enviar Comentário
            </button>
          </div>
        </div>
      </div>
    `;

    
    // Bind Events
    document.getElementById('btn-widget-logout').addEventListener('click', disconnectWidget);
    const textarea = document.getElementById('widget-comment-text');
    const counter = document.getElementById('widget-char-counter');
    const btnSubmit = document.getElementById('btn-widget-submit');
    const alertBox = document.getElementById('widget-alert');
    
    textarea.addEventListener('input', () => {
      const length = textarea.value.length;
      counter.textContent = `${length} / 50 caracteres`;
      
      if (length >= 50) {
        counter.classList.add('valid');
        btnSubmit.disabled = false;
      } else {
        counter.classList.remove('valid');
        btnSubmit.disabled = true;
      }
    });
    
    btnSubmit.addEventListener('click', async () => {
      const text = textarea.value.trim();
      btnSubmit.disabled = true;
      alertBox.classList.add('hidden');
      
      let externalCommentId = 'wp_cmt_' + Math.floor(Math.random() * 1000000);
      let realPostSucceeded = false;
      let corsWarning = false;

      // Se for a Love PG, tenta postar direto no WordPress real
      if (siteId === 'site-lovepg-123') {
        try {
          const wpRes = await fetch('https://lovepg.com.br/wp-json/wp/v2/comments', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              post: parseInt(postId),
              author_name: widgetUser.name,
              author_email: widgetUser.email,
              content: text
            })
          });
          
          if (wpRes.ok) {
            const wpData = await wpRes.json();
            externalCommentId = String(wpData.id); // ID real gerado pelo WordPress!
            realPostSucceeded = true;
            console.log("Comentário publicado direto no WordPress da Love PG com ID:", externalCommentId);
          } else {
            console.warn("Falha ao postar no WordPress real (código de erro).");
          }
        } catch (wpErr) {
          console.warn("Erro de CORS ou rede ao postar direto no WordPress. O Hub Central local prosseguirá em modo de simulação.", wpErr);
          corsWarning = true;
        }
      }

      try {
        const res = await fetch(API_BASE + '/api/blog/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comment_text: text,
            user_token: widgetToken,
            user_ip: testIp,
            site_id: siteId,
            external_comment_id: externalCommentId
          })
        });
        
        const data = await res.json();
        
        if (res.status === 202 && data.status === 'success') {
          alertBox.className = "commentpay-alert success";
          let successMsg = `<i class="fa-solid fa-circle-check"></i> Comentário enviado! Status: <strong>Pendente de Moderação</strong>. R$ 0,50 alocado em saldo pendente no Hub Central.`;
          if (siteId === 'site-lovepg-123') {
            if (realPostSucceeded) {
              successMsg += `<br><span style="font-size:0.75rem;opacity:0.8;"><i class="fa-solid fa-cloud-arrow-up"></i> Publicado diretamente no WordPress real de Love PG (ID: ${externalCommentId}).</span>`;
            } else if (corsWarning) {
              successMsg += `<br><span style="font-size:0.75rem;color:#fbbf24;"><i class="fa-solid fa-triangle-exclamation"></i> <strong>Aviso CORS</strong>: O comentário foi registrado localmente no Hub Central, mas a publicação direta no site live falhou. Veja no console (F12) como liberar o CORS no seu WordPress.</span>`;
            }
          }
          alertBox.innerHTML = successMsg;
          alertBox.classList.remove('hidden');
          textarea.value = '';
          counter.textContent = "0 / 50 caracteres";
          counter.classList.remove('valid');
        } else {
          alertBox.className = "commentpay-alert error";
          alertBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${data.message || 'Erro ao enviar comentário.'}`;
          alertBox.classList.remove('hidden');
          btnSubmit.disabled = false;
        }
      } catch (err) {
        console.error(err);
        alertBox.className = "commentpay-alert error";
        alertBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Erro na comunicação com o servidor do blog.`;
        alertBox.classList.remove('hidden');
        btnSubmit.disabled = false;
      }
    });
  }
}

// --- POPUP DE SSO ---
function openSSOPopup() {
  const width = 600;
  const height = 700;
  const left = (window.innerWidth - width) / 2;
  const top = (window.innerHeight - height) / 2;
  
  const popup = window.open(
    (API_BASE ? API_BASE : '') + '/dashboard', 
    'CommentPaySSO', 
    `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
  );
  
  // Ouve mensagem de sucesso enviada pelo Hub Central
  window.addEventListener('message', function receiveSSOMessage(event) {
    if (event.data && event.data.type === 'SSO_SUCCESS') {
      widgetToken = event.data.token;
      widgetUser = event.data.user;
      
      localStorage.setItem('widget_session_token', widgetToken);
      localStorage.setItem('widget_session_user', JSON.stringify(widgetUser));
      
      const overlay = document.getElementById('commentpay-minigame-overlay');
      if (overlay) overlay.remove();
      
      if (sessionStorage.getItem('pending_anonymous_spin')) {
         sessionStorage.removeItem('pending_anonymous_spin');
         // Faz o spin real no backend de forma silenciosa para salvar o bônus
         fetch((API_BASE ? API_BASE : '') + '/api/v1/minigame/spin', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${widgetToken}` },
             body: JSON.stringify({ domain: window.location.hostname || 'localhost', path: window.location.pathname })
         }).catch(e => console.error(e)).finally(() => renderWidget());
      } else {
        renderWidget();
      }
      window.removeEventListener('message', receiveSSOMessage);
    }
  });
}

// --- DESCONECTAR ---
function disconnectWidget() {
  localStorage.removeItem('widget_session_token');
  localStorage.removeItem('widget_session_user');
  widgetToken = null;
  widgetUser = null;
  renderWidget();
}

// --- CARREGAR COMENTÁRIOS PUBLICADOS ---
async function loadPublishedComments() {
  try {
    const res = await fetch(API_BASE + `/api/v1/comments/demo-list?site_id=${siteId}`);
    const body = await res.json();
    
    if (body.status === 'success') {
      const dbComments = body.data;
      const mockComments = body.mock_comments;
      
      // Mescla os comentários reais aprovados com alguns fictícios de mockup
      const allComments = [...dbComments, ...mockComments];
      
      if (allComments.length === 0) {
        approvedListContainer.innerHTML = `<p class="text-muted">Nenhum comentário publicado ainda. Seja o primeiro!</p>`;
        return;
      }
      
      approvedListContainer.innerHTML = allComments.map(c => {
        const formattedDate = new Date(c.created_at).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        return `
          <div class="comment-item">
            <div class="comment-header">
              <span class="comment-user"><i class="fa-regular fa-user"></i> ${escapeHTML(c.user_name)}</span>
              <span class="comment-date">${formattedDate}</span>
            </div>
            <div class="comment-body">
              ${escapeHTML(c.comment_text || 'Esse artigo sobre investimentos é de alta relevância, apresentando informações bem detalhadas e de fácil entendimento para investidores iniciantes.')}
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error("Erro ao carregar comentários do blog:", err);
  }
}

// --- SEGURANÇA ---
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- MINIGAME ROLETA ---
function showMinigameModal() {
  if (localStorage.getItem('widget_minigame_shown')) return;
  localStorage.setItem('widget_minigame_shown', '1');

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
        background: linear-gradient(180deg, #990000 0%, #4a0000 100%);
        border-radius: 20px; padding: 30px 20px;
        text-align: center; max-width: 380px; width: 90%;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8), 0 0 20px rgba(255, 215, 0, 0.2);
        border: 2px solid #ffd700;
        position: relative; font-family: 'Outfit', 'Inter', sans-serif;
        color: white;
        transition: transform 0.3s ease;
      }
      .commentpay-minigame-modal.victory {
        animation: commentpay-victory-glow 1s infinite alternate;
        border-color: #ffea00;
      }
      @keyframes commentpay-victory-glow {
        0% { box-shadow: 0 0 20px rgba(255, 215, 0, 0.5), inset 0 0 10px rgba(255, 215, 0, 0.2); }
        100% { box-shadow: 0 0 60px rgba(255, 215, 0, 1), inset 0 0 30px rgba(255, 215, 0, 0.8); transform: scale(1.02); }
      }
      @keyframes commentpay-gold-pulse {
        0% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.6), 0 6px 0 #b45309; }
        70% { box-shadow: 0 0 0 15px rgba(255, 215, 0, 0), 0 6px 0 #b45309; }
        100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0), 0 6px 0 #b45309; }
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
        margin: 0 0 5px 0; color: #fff;
        text-shadow: 0 0 15px rgba(255, 215, 0, 0.6), 2px 2px 0px #4a0000;
      }
      .commentpay-subtitle {
        font-size: 0.95rem; font-weight: 500; margin-bottom: 25px;
        color: #ffcccc; font-family: 'Inter', sans-serif;
      }
      .commentpay-wheel-wrapper {
        position: relative; width: 260px; height: 260px; margin: 0 auto 30px auto;
        border-radius: 50%; background: #330000; padding: 8px;
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
          #990000 45deg 90deg,
          #cc0000 90deg 135deg,
          #990000 135deg 180deg,
          #cc0000 180deg 225deg,
          #990000 225deg 270deg,
          #cc0000 270deg 315deg,
          #990000 315deg 360deg
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
      .commentpay-slice.jackpot span { color: #451a03; text-shadow: none; font-size: 0.85rem; }
      .commentpay-slice-line {
        position: absolute; top: 0; left: 50%; width: 2px; height: 50%;
        background: rgba(0,0,0,0.15); transform-origin: bottom center;
      }
      .commentpay-center-hub {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 50px; height: 50px; border-radius: 50%;
        background: radial-gradient(circle, #ff0000 0%, #990000 100%);
        border: 4px solid #e2e8f0;
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
        background: linear-gradient(180deg, #ffd700 0%, #f59e0b 100%);
        color: #451a03; padding: 18px; width: 100%; border: none; border-radius: 30px;
        font-weight: 800; font-size: 1.2rem; cursor: pointer; font-family: 'Outfit', sans-serif;
        text-transform: uppercase; box-shadow: 0 6px 0 #b45309, 0 10px 15px rgba(0,0,0,0.3);
        transition: transform 0.1s, box-shadow 0.1s; margin-top: 10px;
        animation: commentpay-gold-pulse 2s infinite;
      }
      .commentpay-spin-btn:active {
        transform: translateY(6px); box-shadow: 0 0 0 #b45309, 0 4px 5px rgba(0,0,0,0.3);
        animation: none;
      }
      .commentpay-spin-btn:disabled {
        opacity: 0.7; cursor: not-allowed; transform: translateY(6px); box-shadow: 0 0 0 #b45309;
        animation: none;
      }
    `;
    document.head.appendChild(style);
  }

  let overlay = document.createElement('div');
  overlay.className = 'commentpay-minigame-overlay';
  overlay.id = 'commentpay-minigame-overlay';
  overlay.innerHTML = `
    <div class="commentpay-minigame-modal">
      <div class="commentpay-minigame-close" id="commentpay-minigame-close">&times;</div>
      <h2 class="commentpay-title">SUPERSPIN</h2>
      <p class="commentpay-subtitle">Tente ganhar nosso super Jackpot! Gire agora!</p>
      
      <div class="commentpay-wheel-wrapper">
        <div class="commentpay-roulette-pointer">
          <svg viewBox="0 0 24 36" fill="white">
            <path d="M12 36 L0 12 A12 12 0 0 1 24 12 Z" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1"/>
            <circle cx="12" cy="12" r="5" fill="#ef4444"/>
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
          <div class="commentpay-slice jackpot" style="transform: rotate(0deg);"><span>JACKPOT<br>2X</span></div>
          <div class="commentpay-slice" style="transform: rotate(45deg);"><span>SEM BÔNUS</span></div>
          <div class="commentpay-slice jackpot" style="transform: rotate(90deg);"><span>JACKPOT<br>5X</span></div>
          <div class="commentpay-slice" style="transform: rotate(135deg);"><span>TENTE DE NOVO</span></div>
          <div class="commentpay-slice" style="transform: rotate(180deg);"><span>NADA AQUI</span></div>
          <div class="commentpay-slice" style="transform: rotate(225deg);"><span>BÔNUS GRÁTIS</span></div>
          <div class="commentpay-slice" style="transform: rotate(270deg);"><span>QUASE LÁ</span></div>
          <div class="commentpay-slice jackpot" style="transform: rotate(315deg);"><span>JACKPOT<br>10X</span></div>
          
          <div class="commentpay-center-hub"></div>
        </div>
      </div>
      
      <button class="commentpay-spin-btn" id="commentpay-spin-btn">GIRE AGORA</button>
      <p id="commentpay-spin-result" style="margin-top:15px; font-weight:800; min-height:20px; font-size:1.1rem; color:#ffd700;"></p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('commentpay-minigame-close').addEventListener('click', () => overlay.remove());

  const spinBtn = document.getElementById('commentpay-spin-btn');
  spinBtn.addEventListener('click', async () => {
    spinBtn.disabled = true;
    spinBtn.innerText = 'GIRANDO...';
    
    if (!widgetToken) {
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
              openSSOPopup(); 
            };
          } else if (mockMultiplier === -1) {
            resultText.style.color = '#ffd700';
            resultText.innerText = 'QUASE! Você ganhou um giro extra!';
            spinBtn.innerText = 'GIRAR NOVAMENTE';
            spinBtn.disabled = false;
            spinBtn.onclick = () => {
               spinBtn.disabled = true;
               spinBtn.innerText = 'GIRANDO...';
               let newDeg = targetDeg + 360 * 10 + 45; // Vai para 180 (perda garantida)
               wheel.style.transform = `rotate(-${newDeg}deg)`;
               setTimeout(() => {
                  resultText.style.color = '#ffcccc';
                  resultText.innerText = 'NÃO FOI DESSA VEZ. Conecte-se e ganhe R$ 0,50!';
                  spinBtn.innerText = 'CONECTAR CARTEIRA';
                  spinBtn.disabled = false;
                  spinBtn.onclick = () => { openSSOPopup(); };
               }, 10100);
            };
          } else {
            resultText.style.color = '#ffcccc';
            resultText.innerText = 'NÃO FOI DESSA VEZ. Conecte-se e ganhe R$ 0,50!';
            spinBtn.innerText = 'CONECTAR CARTEIRA';
            spinBtn.disabled = false;
            spinBtn.onclick = () => { openSSOPopup(); };
          }
       }, 10100);
       return;
    }

    try {
      const res = await fetch((API_BASE ? API_BASE : '') + '/api/v1/minigame/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${widgetToken}` },
        body: JSON.stringify({ domain: window.location.hostname || 'localhost', path: window.location.pathname })
      });
      const data = await res.json();
      
      if (data.status === 'success') {
        const wheel = document.getElementById('commentpay-roulette-wheel');
        const resultText = document.getElementById('commentpay-spin-result');
        
        let currentRotation = parseFloat(wheel.style.transform.replace(/[^0-9.-]/g, '')) || 0;
        // The regex extracts e.g. -1800 from rotate(-1800deg).
        // Since it's negative, let's treat it as positive turns.
        let baseTurns = Math.abs(currentRotation) + (360 * 10);
        
        let targetDeg = 0;
        if (data.multiplier === 10.0) targetDeg = baseTurns + 315;
        else if (data.multiplier === 5.0) targetDeg = baseTurns + 90;
        else if (data.multiplier === 2.0) targetDeg = baseTurns + 0;
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
            setTimeout(() => { overlay.remove(); renderWidget(); }, 3000);
          } else if (data.multiplier === -1) {
            resultText.style.color = '#ffd700';
            resultText.innerText = 'QUASE! Você ganhou um giro extra!';
            spinBtn.innerText = 'GIRAR NOVAMENTE';
            spinBtn.disabled = false;
          } else {
            resultText.style.color = '#ffcccc';
            resultText.innerText = 'NÃO FOI DESSA VEZ.';
            spinBtn.innerText = 'FEITO!';
            setTimeout(() => { overlay.remove(); renderWidget(); }, 3000);
          }
        }, 10100);
      } else {
        alert(data.message);
        spinBtn.disabled = false;
        spinBtn.innerText = 'Girar Agora!';
      }
    } catch(e) {
      alert('Erro de rede.');
      spinBtn.disabled = false;
      spinBtn.innerText = 'Tentar Novamente';
    }
  });
}

// Inicializa
initWidget();
// Atualiza a lista de comentários publicados a cada 10 segundos
setInterval(loadPublishedComments, 10000);
