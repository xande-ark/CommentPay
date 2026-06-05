<?php
/**
 * INTEGRA├ç├âO NATIVA COMMENTPAY - COPIE E COLE NO FUNCTIONS.PHP DO SEU TEMA ATIVO
 * 
 * Este script intercepta os coment├írios enviados pelo formul├írio nativo do WordPress,
 * captura o IP real do visitante, valida as regras do Central Hub via Webhook seguro
 * e sincroniza o status de aprova├º├úo/modera├º├úo.
 */

// =========================================================================
// 1. CONFIGURA├ç├òES DA INTEGRA├ç├âO
// =========================================================================
define('COMMENTPAY_HUB_URL', 'https://comment-pay.vercel.app');
define('COMMENTPAY_SITE_ID', 'site-lovepg-123');
define('COMMENTPAY_API_SECRET', 'Laggu#5202*');

// =========================================================================
// 2. FUN├ç├âO AUXILIAR PARA PEGAR O IP REAL DO VISITANTE (EVITA PROXIES/CDNs)
// =========================================================================
function commentpay_get_real_ip() {
    $ip = $_SERVER['REMOTE_ADDR'];
    
    // Verifica cabe├ºalho do Cloudflare se ativo
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        $ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
    } 
    // Verifica proxies reversos padr├úo
    elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ips = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $ip = trim($ips[0]);
    }
    
    // Se for localhost (IPv6 ou IPv4), simula um IP para testes locais
    if ($ip === '127.0.0.1' || $ip === '::1') {
        $ip = '177.85.201.42'; // IP de teste padr├úo brasileiro
    }
    
    return $ip;
}

// =========================================================================
// 3. HOOK: INTERCEPTAR ENVIO E VALIDAR NO CENTRAL HUB (WEBHOOK 1)
// =========================================================================
add_action('comment_post', 'commentpay_intercept_comment_submission', 10, 3);
function commentpay_intercept_comment_submission($comment_ID, $comment_approved, $commentdata) {
    // Se n├úo houver token da CommentPay enviado pelo formul├írio, ├® um coment├írio comum
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
    
    // Assinatura digital HMAC para seguran├ºa
    $signature = hash_hmac('sha256', $payload_json, COMMENTPAY_API_SECRET);

    // Envia a requisi├º├úo HTTP POST para o Central Hub
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

    // Trata falhas na requisi├º├úo ou rejei├º├úo de regras (VPN, limites, tamanho de texto)
    if (is_wp_error($response)) {
        wp_delete_comment($comment_ID, true); // Apaga o coment├írio do WordPress
        wp_die(
            '<strong>Erro de Comunica├º├úo com a CommentPay:</strong> N├úo foi poss├¡vel validar o seu saldo. Tente novamente mais tarde.',
            'Erro de Integra├º├úo',
            array('response' => 500, 'back_link' => true)
        );
    }

    $status_code = wp_remote_retrieve_response_code($response);
    $body = json_decode(wp_remote_retrieve_body($response), true);

    if ($status_code !== 202) {
        // Se o Central Hub recusou o coment├írio por quebra de regra
        $error_msg = isset($body['message']) ? $body['message'] : 'Seu coment├írio n├úo atende ├ás regras de remunera├º├úo.';
        
        // Apaga o coment├írio para evitar spam
        wp_delete_comment($comment_ID, true);
        
        // Retorna o erro na tela do usu├írio de forma leg├¡vel
        wp_die(
            '<h3>ÔÜá´©Å Coment├írio N├úo Eleg├¡vel</h3><p>' . esc_html($error_msg) . '</p>',
            'Valida├º├úo CommentPay',
            array('response' => 400, 'back_link' => true)
        );
    }
}

// =========================================================================
// 4. HOOK: SINCRONIZAR A MODERA├ç├âO (APROVA├ç├âO/REJEI├ç├âO DO ADMIN) (WEBHOOK 2)
// =========================================================================
add_action('transition_comment_status', 'commentpay_sync_moderation_status', 10, 3);
function commentpay_sync_moderation_status($new_status, $old_status, $comment) {
    // Sincroniza apenas quando houver mudan├ºa de status relevante
    // Aprovado: 'approved'
    // Rejeitado/Spam: 'spam', 'trash', 'unapproved' (caso j├í estivesse aprovado/pendente)
    
    if ($new_status === 'approved') {
        $status_to_send = 'approved';
    } elseif (in_array($new_status, array('spam', 'trash', 'unapproved'))) {
        $status_to_send = 'rejected';
    } else {
        return; // Outros status intermedi├írios n├úo importam
    }

    // Monta o payload do Webhook 2
    $payload = array(
        'external_comment_id' => strval($comment->comment_ID),
        'status'              => $status_to_send
    );

    $payload_json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    
    // Assinatura digital HMAC
    $signature = hash_hmac('sha256', $payload_json, COMMENTPAY_API_SECRET);

    // Dispara a requisi├º├úo de modera├º├úo de forma ass├¡ncrona (n├úo bloqueia o painel WP)
    wp_remote_post(COMMENTPAY_HUB_URL . '/api/v1/comments/status-update', array(
        'headers'     => array(
            'Content-Type'     => 'application/json',
            'X-Site-ID'        => COMMENTPAY_SITE_ID,
            'X-API-Signature'  => $signature,
        ),
        'body'        => $payload_json,
        'data_format' => 'body',
        'timeout'     => 10,
        'blocking'    => false, // N├úo bloqueia o carregamento do admin do WordPress
    ));
}

// =========================================================================
// 5. INJETAR O SCRIPT WP-INTEGRATION NO RODAP├ë DO SEU SITE
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
// 6. ROTA DA API: RECEBER APROVA├ç├âO/REJEI├ç├âO DO COMMENTPAY (WEBHOOK 3)
// =========================================================================
add_action('rest_api_init', function () {
    register_rest_route('commentpay/v1', '/sync-status', array(
        'methods' => 'POST',
        'callback' => 'commentpay_receive_sync_status',
        'permission_callback' => '__return_true', // Seguran├ºa gerida via HMAC
    ));
});

function commentpay_receive_sync_status($request) {
    
    $payload_raw = $request->get_body();
    $signature = $request->get_header('X-API-Signature');
    
    // Valida├º├úo da assinatura digital
    $expected_signature = hash_hmac('sha256', $payload_raw, COMMENTPAY_API_SECRET);
    
    if (!hash_equals($expected_signature, $signature)) {
        return new WP_REST_Response(array('status' => 'error', 'message' => 'Assinatura digital inv├ílida.'), 403);
    }
    
    $params = json_decode($payload_raw, true);
    $comment_id = isset($params['external_comment_id']) ? intval($params['external_comment_id']) : 0;
    $status = isset($params['status']) ? sanitize_text_field($params['status']) : '';
    
    if ($comment_id <= 0 || !in_array($status, array('approved', 'rejected'))) {
        return new WP_REST_Response(array('status' => 'error', 'message' => 'Par├ómetros inv├ílidos.'), 400);
    }
    
    $wp_status = ($status === 'approved') ? 'approve' : 'trash';
    
    // Removemos nosso pr├│prio hook de sincroniza├º├úo para evitar loop infinito
    remove_action('transition_comment_status', 'commentpay_sync_moderation_status', 10);
    
    $result = wp_set_comment_status($comment_id, $wp_status);
    
    // Readiciona o hook caso outras coisas ocorram depois
    add_action('transition_comment_status', 'commentpay_sync_moderation_status', 10, 3);
    
    if (is_wp_error($result)) {
        return new WP_REST_Response(array('status' => 'error', 'message' => 'Erro ao atualizar coment├írio no WordPress.'), 500);
    }
    
    return new WP_REST_Response(array('status' => 'success', 'message' => 'Status do coment├írio atualizado com sucesso.'), 200);
}
