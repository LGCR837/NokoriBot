<?php
require_once __DIR__ . '/config.php';

function jsonResponse(mixed $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function readJson(string $path): ?array {
    if (!file_exists($path)) return null;
    $content = file_get_contents($path);
    if ($content === false) return null;
    $data = json_decode($content, true);
    return json_last_error() === JSON_ERROR_NONE ? $data : null;
}

function writeJson(string $path, mixed $data): bool {
    $dir = dirname($path);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    return file_put_contents($path, $json) !== false;
}

function listPlugins(): array {
    $plugins = [];
    if (!is_dir(PLUGINS_DIR)) return $plugins;
    $dirs = scandir(PLUGINS_DIR);
    foreach ($dirs as $dir) {
        if ($dir === '.' || $dir === '..') continue;
        $metaFile = PLUGINS_DIR . '/' . $dir . '/meta.json';
        $meta = readJson($metaFile);
        if ($meta) {
            $meta['id'] = $dir;
            $plugins[] = $meta;
        }
    }
    // 按上传时间倒序
    usort($plugins, fn($a, $b) => strcmp($b['uploaded_at'] ?? '', $a['uploaded_at'] ?? ''));
    return $plugins;
}

function getPlugin(string $id): ?array {
    $metaFile = PLUGINS_DIR . '/' . $id . '/meta.json';
    $meta = readJson($metaFile);
    if ($meta) $meta['id'] = $id;
    return $meta;
}

function savePluginMeta(string $id, array $meta): bool {
    $metaFile = PLUGINS_DIR . '/' . $id . '/meta.json';
    return writeJson($metaFile, $meta);
}

function sanitizeFilename(string $name): string {
    return preg_replace('/[^a-zA-Z0-9_\-.]/', '_', $name);
}
