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
function initWidget() {
  renderWidget();
  loadPublishedComments();
}

// --- RENDERIZAR O WIDGET ---
function renderWidget() {
  if (!widgetToken || !widgetUser) {
    // ESTADO: DESLOGADO
    widgetContainer.innerHTML = `
      <div class="commentpay-widget-box">
        <div class="commentpay-logged-out">
          <p><i class="fa-solid fa-lock text-purple"></i> Faça login utilizando sua conta do Central Hub para comentar e ser remunerado.</p>
          <button id="btn-widget-login" class="commentpay-btn">
            <i class="fa-solid fa-comments-dollar"></i> Entrar com CommentPay
          </button>
        </div>
      </div>
    `;
    
    document.getElementById('btn-widget-login').addEventListener('click', openSSOPopup);
  } else {
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
          
          <div style="display: flex; justify-content: space-between; align-items: center;">
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
      localStorage.setItem('widget_session_token', event.data.token);
      localStorage.setItem('widget_session_user', JSON.stringify(event.data.user));
      
      widgetToken = event.data.token;
      widgetUser = event.data.user;
      
      renderWidget();
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

// Inicializa
initWidget();
// Atualiza a lista de comentários publicados a cada 10 segundos
setInterval(loadPublishedComments, 10000);
