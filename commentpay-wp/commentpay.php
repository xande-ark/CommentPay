<?php
/**
 * Plugin Name: CommentPay Integration
 * Plugin URI: https://comentarioslucrativos.com
 * Description: Integração oficial do CommentPay com o seu site WordPress. Este plugin cria uma API segura para verificar comentários remunerados e instrui automaticamente a Cloudflare a não usar cache nesta rota.
 * Version: 1.0.0
 * Author: CommentPay
 * License: GPL2
 */

// Impede o acesso direto ao arquivo
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// Registra a rota da API REST
add_action('rest_api_init', function () {
    register_rest_route('commentpay/v1', '/comments', array(
        'methods' => 'POST',
        'callback' => 'commentpay_verify_comment',
        'permission_callback' => '__return_true', // Segurança gerida via secret_key
    ));
});

function commentpay_verify_comment($request) {
    // 1. FORÇA A CLOUDFLARE E OUTROS CACHES A IGNORAREM ESTA RESPOSTA
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Cache-Control: post-check=0, pre-check=0', false);
    header('Pragma: no-cache');
    header('Expires: Wed, 11 Jan 1984 05:00:00 GMT'); // Data no passado

    $params = $request->get_json_params();
    
    // Obter os parâmetros recebidos
    $post_url = isset($params['post_url']) ? sanitize_text_field($params['post_url']) : '';
    $user_email = isset($params['user_email']) ? sanitize_email($params['user_email']) : '';
    $secret_key = isset($params['secret_key']) ? sanitize_text_field($params['secret_key']) : '';
    
    // ------------------------------------------------------------------
    // IMPORTANTE: Configure a mesma chave de segurança do seu painel aqui
    // ------------------------------------------------------------------
    $EXPECTED_SECRET = 'commentpay_master_key_123!';
    
    // Validar a chave de segurança
    if ($secret_key !== $EXPECTED_SECRET) {
        return new WP_REST_Response(array(
            'status' => 'error',
            'message' => 'Chave de segurança (secret_key) inválida.'
        ), 403);
    }
    
    if (empty($post_url) || empty($user_email)) {
        return new WP_REST_Response(array(
            'status' => 'error',
            'message' => 'Parâmetros post_url e user_email são obrigatórios.'
        ), 400);
    }
    
    // Tentar descobrir o ID do Post a partir da URL
    $post_id = url_to_postid($post_url);
    
    if ($post_id === 0) {
        return new WP_REST_Response(array(
            'status' => 'error',
            'message' => 'Não foi possível encontrar um post com esta URL.'
        ), 404);
    }
    
    // Buscar os comentários do post feitos por esse e-mail
    $args = array(
        'post_id' => $post_id,
        'author_email' => $user_email,
        'status' => 'approve', // Somente comentários aprovados
        'orderby' => 'comment_date',
        'order' => 'DESC',
        'number' => 1 // Pegar o mais recente
    );
    
    $comments = get_comments($args);
    
    if (empty($comments)) {
        return new WP_REST_Response(array(
            'status' => 'error',
            'message' => 'Nenhum comentário aprovado encontrado para este e-mail neste artigo.'
        ), 404);
    }
    
    // Sucesso! Retorna os dados do comentário mais recente
    $latest_comment = $comments[0];
    
    return new WP_REST_Response(array(
        'status' => 'success',
        'data' => array(
            'comment_id' => $latest_comment->comment_ID,
            'content' => $latest_comment->comment_content,
            'date' => $latest_comment->comment_date
        )
    ), 200);
}
