<?php
session_start();

require_once __DIR__ . '/db.php';

function login(int $userId, string $username): void {
    $_SESSION['user_id'] = $userId;
    $_SESSION['username'] = $username;
}

function logout(): void {
    session_destroy();
}

function isLoggedIn(): bool {
    return isset($_SESSION['user_id']);
}

function currentUserId(): ?int {
    return $_SESSION['user_id'] ?? null;
}

function currentUsername(): ?string {
    return $_SESSION['username'] ?? null;
}

function requireLogin(): array {
    if (!isLoggedIn()) {
        http_response_code(401);
        echo json_encode(['error' => '请先登录']);
        exit;
    }
    return ['id' => currentUserId(), 'username' => currentUsername()];
}
