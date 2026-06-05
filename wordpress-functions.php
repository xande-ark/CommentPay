<?php
/**
 * INTEGRAÇÃO NATIVA COMMENTPAY - COPIE E COLE NO FUNCTIONS.PHP DO SEU TEMA ATIVO
 * 
 * Este script intercepta os comentários enviados pelo formulário nativo do WordPress,
 * captura o IP real do visitante, valida as regras do Central Hub via Webhook seguro
 * e sincroniza o status de aprovação/moderação.
 */

// =========================================================================
// 1. CONFIGURAÇÕES DA INTEGRAÇÃO
// =========================================================================
define('COMMENTPAY_HUB_URL', 'https://8283eba5b1a8c5fe-138-219-202-201.serveousercontent.com');
define('COMMENTPAY_SITE_ID', 'site-lovepg-123');
define('COMMENTPAY_API_SECRET', 'api_secret_key_lovepg_789');

// =========================================================================
// 2. FUNÇÃO AUXILIAR PARA PEGAR O IP REAL DO VISITANTE (EVITA PROXIES/CDNs)
// =========================================================================
function commentpay_get_real_ip() {
    $ip = $_SERVER['REMOTE_ADDR'];
    
    // Verifica cabeçalho do Cloudflare se ativo
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        $ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
    } 
    // Verifica proxies reversos padrão
    elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ips = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $ip = trim($ips[0]);
    }
    
    // Se for localhost (IPv6 ou IPv4), simula um IP para testes locais
    if ($ip === '127.0.0.1' || $ip === '::1') {
        $ip = '177.85.201.42'; // IP de teste padrão brasileiro
    }
    
    return $ip;
}

// =========================================================================
// 3. HOOK: INTERCEPTAR ENVIO E VALIDAR NO CENTRAL HUB (WEBHOOK 1)
// =========================================================================
add_action('comment_post', 'commentpay_intercept_comment_submission', 10, 3);
function commentpay_intercept_comment_submission($comment_ID, $comment_approved, $commentdata) {
    // Se não houver token da CommentPay enviado pelo formulário, é um comentário comum
    if (empty($_POST['commentpay_token'])) {
        return;
    }

    $token = sanitize_text_field($_POST['commentpay_token']);
    $comment_text = $commentdata['comment_content'];
    $user_ip = commentpay_get_real_ip();
    $user_agent = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : 'WordPress';

    // Monta o payload do Webhook 1
    $payload = array(
        'user_token'          => $token,
        'external_comment_id' => strval($comment_ID),
        'comment_text'        => $comment_text,
        'user_ip'             => $user_ip,
        'user_agent'          => $user_agent
    );

    $payload_json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    
    // Assinatura digital HMAC para segurança
    $signature = hash_hmac('sha256', $payload_json, COMMENTPAY_API_SECRET);

    // Envia a requisição HTTP POST para o Central Hub
    $response = wp_remote_post(COMMENTPAY_HUB_URL . '/api/v1/comments/submit', array(
        'headers'     => array(
            'Content-Type'     => 'application/json',
            'X-Site-ID'        => COMMENTPAY_SITE_ID,
            'X-API-Signature'  => $signature,
        ),
        'body'        => $payload_json,
        'data_format' => 'body',
        'timeout'     => 15,
    ));

    // Trata falhas na requisição ou rejeição de regras (VPN, limites, tamanho de texto)
    if (is_wp_error($response)) {
        wp_delete_comment($comment_ID, true); // Apaga o comentário do WordPress
        wp_die(
            '<strong>Erro de Comunicação com a CommentPay:</strong> Não foi possível validar o seu saldo. Tente novamente mais tarde.',
            'Erro de Integração',
            array('response' => 500, 'back_link' => true)
        );
    }

    $status_code = wp_remote_retrieve_response_code($response);
    $body = json_decode(wp_remote_retrieve_body($response), true);

    if ($status_code !== 202) {
        // Se o Central Hub recusou o comentário por quebra de regra
        $error_msg = isset($body['message']) ? $body['message'] : 'Seu comentário não atende às regras de remuneração.';
        
        // Apaga o comentário para evitar spam
        wp_delete_comment($comment_ID, true);
        
        // Retorna o erro na tela do usuário de forma legível
        wp_die(
            '<h3>⚠️ Comentário Não Elegível</h3><p>' . esc_html($error_msg) . '</p>',
            'Validação CommentPay',
            array('response' => 400, 'back_link' => true)
        );
    }
}

// =========================================================================
// 4. HOOK: SINCRONIZAR A MODERAÇÃO (APROVAÇÃO/REJEIÇÃO DO ADMIN) (WEBHOOK 2)
// =========================================================================
add_action('transition_comment_status', 'commentpay_sync_moderation_status', 10, 3);
function commentpay_sync_moderation_status($new_status, $old_status, $comment) {
    // Sincroniza apenas quando houver mudança de status relevante
    // Aprovado: 'approved'
    // Rejeitado/Spam: 'spam', 'trash', 'unapproved' (caso já estivesse aprovado/pendente)
    
    if ($new_status === 'approved') {
        $status_to_send = 'approved';
    } elseif (in_array($new_status, array('spam', 'trash', 'unapproved'))) {
        $status_to_send = 'rejected';
    } else {
        return; // Outros status intermediários não importam
    }

    // Monta o payload do Webhook 2
    $payload = array(
        'external_comment_id' => strval($comment->comment_ID),
        'status'              => $status_to_send
    );

    $payload_json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    
    // Assinatura digital HMAC
    $signature = hash_hmac('sha256', $payload_json, COMMENTPAY_API_SECRET);

    // Dispara a requisição de moderação de forma assíncrona (não bloqueia o painel WP)
    wp_remote_post(COMMENTPAY_HUB_URL . '/api/v1/comments/status-update', array(
        'headers'     => array(
            'Content-Type'     => 'application/json',
            'X-Site-ID'        => COMMENTPAY_SITE_ID,
            'X-API-Signature'  => $signature,
        ),
        'body'        => $payload_json,
        'data_format' => 'body',
        'timeout'     => 10,
        'blocking'    => false, // Não bloqueia o carregamento do admin do WordPress
    ));
}

// =========================================================================
// 5. INJETAR O SCRIPT WP-INTEGRATION NO RODAPÉ DO SEU SITE
// =========================================================================
add_action('wp_footer', 'commentpay_inject_integration_script');
function commentpay_inject_integration_script() {
    // Carrega o script JavaScript que ativa o SSO e o banner de login
    $script_url = COMMENTPAY_HUB_URL . '/wp-integration.js';
    ?>
    <script>
        window.commentpayHubUrl = "<?php echo esc_url(COMMENTPAY_HUB_URL); ?>";
    </script>
    <script src="<?php echo esc_url($script_url); ?>" defer></script>
    <?php
}

// =========================================================================
// 6. ROTA DA API: RECEBER APROVAÇÃO/REJEIÇÃO DO COMMENTPAY (WEBHOOK 3)
// =========================================================================
add_action('rest_api_init', function () {
    register_rest_route('commentpay/v1', '/sync-status', array(
        'methods' => 'POST',
        'callback' => 'commentpay_receive_sync_status',
        'permission_callback' => '__return_true', // Segurança gerida via HMAC
    ));
});

function commentpay_receive_sync_status($request) {
    // 1. FORÇA A CLOUDFLARE A NÃO FAZER CACHE DESTA RESPOSTA
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Cache-Control: post-check=0, pre-check=0', false);
    header('Pragma: no-cache');
    
    $payload_raw = $request->get_body();
    $signature = $request->get_header('X-API-Signature');
    
    // Validação da assinatura digital
    $expected_signature = hash_hmac('sha256', $payload_raw, COMMENTPAY_API_SECRET);
    
    if (!hash_equals($expected_signature, $signature)) {
        return new WP_REST_Response(array('status' => 'error', 'message' => 'Assinatura digital inválida.'), 403);
    }
    
    $params = json_decode($payload_raw, true);
    $comment_id = isset($params['external_comment_id']) ? intval($params['external_comment_id']) : 0;
    $status = isset($params['status']) ? sanitize_text_field($params['status']) : '';
    
    if ($comment_id <= 0 || !in_array($status, array('approved', 'rejected'))) {
        return new WP_REST_Response(array('status' => 'error', 'message' => 'Parâmetros inválidos.'), 400);
    }
    
    $wp_status = ($status === 'approved') ? 'approve' : 'trash';
    
    // Removemos nosso próprio hook de sincronização para evitar loop infinito
    remove_action('transition_comment_status', 'commentpay_sync_moderation_status', 10);
    
    $result = wp_set_comment_status($comment_id, $wp_status);
    
    // Readiciona o hook caso outras coisas ocorram depois
    add_action('transition_comment_status', 'commentpay_sync_moderation_status', 10, 3);
    
    if (is_wp_error($result)) {
        return new WP_REST_Response(array('status' => 'error', 'message' => 'Erro ao atualizar comentário no WordPress.'), 500);
    }
    
    return new WP_REST_Response(array('status' => 'success', 'message' => 'Status do comentário atualizado com sucesso.'), 200);
}
